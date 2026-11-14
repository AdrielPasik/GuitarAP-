-- Apply only in a dedicated Supabase project after setting the environment variables.
create table if not exists public.documents (
  id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('tablature','fretboard')), title text not null,
  payload jsonb not null, rev bigint not null default 1, deleted_at timestamptz, updated_at timestamptz not null default now()
);
alter table public.documents enable row level security;
create policy "own documents only" on public.documents for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create or replace function public.update_document(p_id uuid, p_base_rev bigint, p_payload jsonb, p_title text)
returns public.documents language plpgsql security invoker as $$ declare row public.documents; begin
 update public.documents set payload=p_payload,title=p_title,rev=rev+1,updated_at=now() where id=p_id and owner_id=auth.uid() and rev=p_base_rev returning * into row;
 return row;
end $$;
