-- Additive hardening for a project that already ran 0001 and 0002.
-- It retains existing rows and makes the RPC return the complete local document envelope.
alter table public.documents add column if not exists node_id uuid;
alter table public.documents add column if not exists song_id uuid;
alter table public.documents add column if not exists created_at timestamptz not null default now();

create or replace function public.sync_documents(p_owner_id uuid, p_op_id uuid, p_documents jsonb)
returns jsonb language plpgsql security invoker as $$
declare item jsonb; current public.documents; applied jsonb := '[]'::jsonb; conflicts jsonb := '[]'::jsonb; cached jsonb;
begin
  if auth.uid() is null or p_owner_id <> auth.uid() then raise exception 'owner mismatch'; end if;
  select result into cached from public.sync_operations where owner_id=p_owner_id and op_id=p_op_id;
  if cached is not null then return cached; end if;
  for item in select * from jsonb_array_elements(p_documents) loop
    select * into current from public.documents where id=(item->>'id')::uuid and owner_id=auth.uid() for update;
    if current is not null and current.rev <> (item->>'rev')::bigint - 1 then
      conflicts := conflicts || jsonb_build_array(to_jsonb(current) || jsonb_build_object('content', current.payload, 'ownerId', auth.uid(), 'lastOpId', p_op_id));
    else
      insert into public.documents(id, owner_id, node_id, song_id, type, title, payload, rev, deleted_at, created_at, updated_at)
      values (
        (item->>'id')::uuid, auth.uid(), nullif(item->>'nodeId','')::uuid, nullif(item->>'songId','')::uuid,
        item->>'type', item->>'title', item->'content', (item->>'rev')::bigint,
        case when item->>'deletedAt' is null then null else to_timestamp((item->>'deletedAt')::double precision / 1000) end,
        to_timestamp((item->>'createdAt')::double precision / 1000), to_timestamp((item->>'updatedAt')::double precision / 1000)
      )
      on conflict (id) do update set node_id=excluded.node_id, song_id=excluded.song_id, type=excluded.type, title=excluded.title, payload=excluded.payload, rev=excluded.rev, deleted_at=excluded.deleted_at, updated_at=excluded.updated_at
      where public.documents.owner_id=auth.uid()
      returning * into current;
      if current is null then raise exception 'document id belongs to another account'; end if;
      applied := applied || jsonb_build_array(to_jsonb(current) || jsonb_build_object('content', current.payload, 'ownerId', auth.uid(), 'lastOpId', p_op_id));
    end if;
  end loop;
  cached := jsonb_build_object('applied', applied, 'conflicts', conflicts);
  insert into public.sync_operations(owner_id, op_id, result) values (auth.uid(), p_op_id, cached);
  return cached;
end $$;

create or replace function public.pull_documents(p_owner_id uuid, p_after_updated_at timestamptz)
returns jsonb language sql security invoker as $$
  select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object('content', d.payload, 'ownerId', auth.uid(), 'lastOpId', '')), '[]'::jsonb)
  from public.documents d
  where d.owner_id = auth.uid() and p_owner_id = auth.uid() and d.updated_at > p_after_updated_at;
$$;
