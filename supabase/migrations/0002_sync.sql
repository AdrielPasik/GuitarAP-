-- Idempotent optimistic-concurrency sync. Execute after 0001_guitarap.sql.
create table if not exists public.sync_operations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  op_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, op_id)
);
alter table public.sync_operations enable row level security;
create policy "own sync operations" on public.sync_operations for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create or replace function public.sync_documents(p_owner_id uuid, p_op_id uuid, p_documents jsonb)
returns jsonb language plpgsql security invoker as $$
declare item jsonb; current public.documents; applied jsonb := '[]'::jsonb; conflicts jsonb := '[]'::jsonb; cached jsonb;
begin
  if p_owner_id <> auth.uid() then raise exception 'owner mismatch'; end if;
  select result into cached from public.sync_operations where owner_id=p_owner_id and op_id=p_op_id;
  if cached is not null then return cached; end if;
  for item in select * from jsonb_array_elements(p_documents) loop
    select * into current from public.documents where id=(item->>'id')::uuid and owner_id=p_owner_id for update;
    if current is not null and current.rev <> (item->>'rev')::bigint - 1 then
      conflicts := conflicts || jsonb_build_array(to_jsonb(current) || jsonb_build_object('ownerId', p_owner_id, 'lastOpId', p_op_id));
    else
      insert into public.documents(id,owner_id,type,title,payload,rev,deleted_at,updated_at) values ((item->>'id')::uuid,p_owner_id,item->>'type',item->>'title',item->'content',(item->>'rev')::bigint,null,to_timestamp((item->>'updatedAt')::double precision/1000))
      on conflict (id) do update set type=excluded.type,title=excluded.title,payload=excluded.payload,rev=excluded.rev,updated_at=excluded.updated_at
      returning * into current;
      applied := applied || jsonb_build_array(to_jsonb(current) || jsonb_build_object('content', current.payload, 'ownerId', p_owner_id, 'lastOpId', p_op_id, 'nodeId', item->'nodeId', 'songId', item->'songId', 'createdAt', item->'createdAt', 'updatedAt', item->'updatedAt'));
    end if;
  end loop;
  cached := jsonb_build_object('applied',applied,'conflicts',conflicts);
  insert into public.sync_operations(owner_id,op_id,result) values (p_owner_id,p_op_id,cached);
  return cached;
end $$;

create or replace function public.pull_documents(p_owner_id uuid, p_after_updated_at timestamptz)
returns jsonb language sql security invoker as $$
  select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object('content',d.payload,'ownerId',d.owner_id,'lastOpId','')), '[]'::jsonb)
  from public.documents d where d.owner_id = auth.uid() and d.owner_id = p_owner_id and d.updated_at > p_after_updated_at;
$$;
