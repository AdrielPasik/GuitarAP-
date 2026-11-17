-- GuitarAP 0007: sharing and collaboration.
--
-- ADDITIVE ONLY. It creates new tables and functions and adds one nullable column. It does not update, delete or
-- re-grant anything that 0001-0006 created, so every existing library keeps working while this is unapplied or applied.
-- A rollback that removes only what this file adds is in 0007_sharing_rollback.sql.
--
-- Model
--   * A project is a document (a song/notebook) or a library node (a folder or a song grouping).
--   * share_members: explicit people with a role (editor | commenter | viewer) on a project. The owner is implicit
--     (documents.owner_id). Access to a folder is by CONTAINMENT: a document is reachable if it, or any ancestor
--     folder/song grouping, is shared, and the share is not revoked. Moving a document out of a shared folder ends
--     that access; moving one in grants it; trashing the folder suspends it.
--   * share_links: unguessable read-only links. Only SHA-256 of the token is stored; the token is shown once. An
--     optional password is stored only as a bcrypt verifier. Links expire and can be revoked.
--   * share_invites: one-time invitation tokens; the invitee must sign in with an existing account (registration
--     stays closed) and accept. No admin API is needed in the browser.
--   * share_activity: who did what, readable by the project's owner and editors.
--
-- Security rules this file enforces (and tests/db proves against a real PostgreSQL engine):
--   * Row Level Security is enabled on every new table with NO policy for anon/authenticated: the browser cannot read or
--     write them directly. All access goes through SECURITY DEFINER functions that check auth.uid() themselves.
--   * documents / library_nodes keep their owner-only policies. Nothing here adds a generic SELECT.
--   * Permissions are resolved on the server on every call (a revoked collaborator is refused even with an old session).
--   * Passwords: bcrypt (cost 10), never logged, never returned. Failed unlocks are counted per link and lock it.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.document_versions add column if not exists author_id uuid;

create table if not exists public.share_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  resource_kind text not null check (resource_kind in ('document', 'node')),
  resource_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('editor', 'commenter', 'viewer')),
  label text not null default 'Colaborador' check (char_length(label) <= 60),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (resource_kind, resource_id, user_id)
);
create index if not exists share_members_user on public.share_members (user_id) where revoked_at is null;
create index if not exists share_members_resource on public.share_members (resource_kind, resource_id);

create table if not exists public.share_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  resource_kind text not null check (resource_kind in ('document', 'node')),
  resource_id uuid not null,
  role text not null check (role in ('editor', 'commenter', 'viewer')),
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  resource_kind text not null check (resource_kind in ('document', 'node')),
  resource_id uuid not null,
  token_hash bytea not null unique,
  password_hash text,
  expires_at timestamptz,
  revoked_at timestamptz,
  allow_export boolean not null default false,
  created_at timestamptz not null default now(),
  failed_attempts int not null default 0,
  locked_until timestamptz,
  open_count bigint not null default 0,
  last_opened_at timestamptz
);

create table if not exists public.share_sessions (
  token_hash bytea primary key,
  link_id uuid not null references public.share_links(id) on delete cascade,
  expires_at timestamptz not null
);

create table if not exists public.share_activity (
  id bigserial primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  resource_kind text not null,
  resource_id uuid not null,
  actor_id uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists share_activity_resource on public.share_activity (resource_kind, resource_id, id desc);

create table if not exists public.collab_ops (
  op_id uuid primary key,
  document_id uuid not null,
  actor_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.share_members enable row level security;
alter table public.share_invites enable row level security;
alter table public.share_links enable row level security;
alter table public.share_sessions enable row level security;
alter table public.share_activity enable row level security;
alter table public.collab_ops enable row level security;
revoke all on public.share_members, public.share_invites, public.share_links, public.share_sessions, public.share_activity, public.collab_ops from public, anon, authenticated;
revoke all on sequence public.share_activity_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------- internal helpers (not exposed)

create or replace function private.new_token() returns text
language sql volatile set search_path = pg_catalog, extensions
as $$ select translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=' || E'\n', '-_') $$;

create or replace function private.token_hash(p_token text) returns bytea
language sql immutable set search_path = pg_catalog, extensions
as $$ select extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256') $$;

create or replace function private.require_user() returns uuid
language plpgsql stable set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return auth.uid();
end $$;

create or replace function private.log_activity(p_owner uuid, p_kind text, p_id uuid, p_actor uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns void language sql volatile security definer set search_path = pg_catalog, public
as $$ insert into public.share_activity(owner_id, resource_kind, resource_id, actor_id, action, detail) values (p_owner, p_kind, p_id, p_actor, p_action, coalesce(p_detail, '{}'::jsonb)) $$;

-- Nodes that contain a document: its folder, its song grouping and every ancestor (live nodes only).
create or replace function private.containing_nodes(p_doc uuid) returns setof uuid
language sql stable security definer set search_path = pg_catalog, public
as $$
  with recursive up(id, parent_id) as (
    select n.id, n.parent_id from public.library_nodes n
    join public.documents d on d.id = p_doc and (n.id = d.node_id or n.id = d.song_id)
    where n.deleted_at is null
    union
    select n.id, n.parent_id from public.library_nodes n join up on n.id = up.parent_id
    where n.deleted_at is null
  )
  select id from up
$$;

-- The role a user has on a document: owner | editor | commenter | viewer | null (no access).
create or replace function private.doc_role(p_doc uuid, p_user uuid) returns text
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare d public.documents; found_role text;
begin
  if p_user is null then return null; end if;
  select * into d from public.documents where id = p_doc and deleted_at is null;
  if d.id is null then return null; end if;
  if d.owner_id = p_user then return 'owner'; end if;
  select m.role into found_role
  from public.share_members m
  where m.user_id = p_user and m.revoked_at is null and m.owner_id = d.owner_id
    and ((m.resource_kind = 'document' and m.resource_id = p_doc)
      or (m.resource_kind = 'node' and m.resource_id in (select private.containing_nodes(p_doc))))
  order by case m.role when 'editor' then 1 when 'commenter' then 2 else 3 end
  limit 1;
  return found_role;
end $$;

create or replace function private.owns_resource(p_kind text, p_id uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$
  select case p_kind
    when 'document' then exists (select 1 from public.documents d where d.id = p_id and d.owner_id = p_user and d.deleted_at is null)
    when 'node' then exists (select 1 from public.library_nodes n where n.id = p_id and n.owner_id = p_user and n.deleted_at is null)
    else false end
$$;

create or replace function private.resource_title(p_kind text, p_id uuid) returns text
language sql stable security definer set search_path = pg_catalog, public
as $$
  select case p_kind when 'document' then (select title from public.documents where id = p_id)
                     else (select name from public.library_nodes where id = p_id) end
$$;

-- Documents reachable through a folder: everything live under it (its folders and song groupings).
create or replace function private.documents_under(p_node uuid) returns setof uuid
language sql stable security definer set search_path = pg_catalog, public
as $$
  with recursive down(id) as (
    select n.id from public.library_nodes n where n.id = p_node and n.deleted_at is null
    union
    select n.id from public.library_nodes n join down on n.parent_id = down.id where n.deleted_at is null
  )
  select d.id from public.documents d
  where d.deleted_at is null
    and d.owner_id = (select owner_id from public.library_nodes where id = p_node)
    and (d.node_id in (select id from down) or d.song_id in (select id from down))
$$;

-- Reader-facing copy of a notebook: personal comments are not part of a read-only link.
create or replace function private.public_content(p_content jsonb) returns jsonb
language sql immutable set search_path = pg_catalog
as $$ select case when jsonb_typeof(p_content) = 'object' then p_content - 'comments' else p_content end $$;

-- ---------------------------------------------------------------- owner: links

create or replace function public.share_create_link(
  p_kind text, p_id uuid, p_password text default null, p_expires timestamptz default null, p_allow_export boolean default false
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions
as $$
declare me uuid := private.require_user(); token text := private.new_token(); link_id uuid;
begin
  if not private.owns_resource(p_kind, p_id, me) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_password is not null and char_length(p_password) < 8 then raise exception 'password too short' using errcode = '22023'; end if;
  if p_expires is not null and p_expires <= now() then raise exception 'expiry must be in the future' using errcode = '22023'; end if;
  insert into public.share_links(owner_id, resource_kind, resource_id, token_hash, password_hash, expires_at, allow_export)
  values (me, p_kind, p_id, private.token_hash(token),
          case when p_password is null then null else extensions.crypt(p_password, extensions.gen_salt('bf', 10)) end,
          p_expires, coalesce(p_allow_export, false))
  returning id into link_id;
  perform private.log_activity(me, p_kind, p_id, me, 'link_created', jsonb_build_object('passwordProtected', p_password is not null));
  return jsonb_build_object('id', link_id, 'token', token);
end $$;

create or replace function public.share_update_link(
  p_link_id uuid, p_password text default null, p_remove_password boolean default false,
  p_expires timestamptz default null, p_clear_expiry boolean default false, p_allow_export boolean default null
) returns void
language plpgsql security definer set search_path = pg_catalog, public, extensions
as $$
declare me uuid := private.require_user(); l public.share_links;
begin
  select * into l from public.share_links where id = p_link_id and owner_id = me for update;
  if l.id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_password is not null and char_length(p_password) < 8 then raise exception 'password too short' using errcode = '22023'; end if;
  if p_expires is not null and p_expires <= now() then raise exception 'expiry must be in the future' using errcode = '22023'; end if;
  update public.share_links set
    password_hash = case when p_remove_password then null when p_password is not null then extensions.crypt(p_password, extensions.gen_salt('bf', 10)) else password_hash end,
    expires_at = case when p_clear_expiry then null when p_expires is not null then p_expires else expires_at end,
    allow_export = coalesce(p_allow_export, allow_export),
    failed_attempts = case when p_password is not null or p_remove_password then 0 else failed_attempts end,
    locked_until = case when p_password is not null or p_remove_password then null else locked_until end
  where id = p_link_id;
  -- A new password ends every session that was unlocked with the old one.
  if p_password is not null or p_remove_password then delete from public.share_sessions where link_id = p_link_id; end if;
  perform private.log_activity(me, l.resource_kind, l.resource_id, me, 'link_updated');
end $$;

create or replace function public.share_revoke_link(p_link_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare me uuid := private.require_user(); l public.share_links;
begin
  select * into l from public.share_links where id = p_link_id and owner_id = me for update;
  if l.id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.share_links set revoked_at = coalesce(revoked_at, now()) where id = p_link_id;
  delete from public.share_sessions where link_id = p_link_id;
  perform private.log_activity(me, l.resource_kind, l.resource_id, me, 'link_revoked');
end $$;

-- ---------------------------------------------------------------- owner: invitations and members

create or replace function public.share_create_invite(p_kind text, p_id uuid, p_role text, p_expires timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions
as $$
declare me uuid := private.require_user(); token text := private.new_token(); invite_id uuid;
begin
  if p_role not in ('editor', 'commenter', 'viewer') then raise exception 'invalid role' using errcode = '22023'; end if;
  if not private.owns_resource(p_kind, p_id, me) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.share_invites(owner_id, resource_kind, resource_id, role, token_hash, expires_at)
  values (me, p_kind, p_id, p_role, private.token_hash(token), coalesce(p_expires, now() + interval '7 days'))
  returning id into invite_id;
  perform private.log_activity(me, p_kind, p_id, me, 'invite_created', jsonb_build_object('role', p_role));
  return jsonb_build_object('id', invite_id, 'token', token);
end $$;

create or replace function public.share_revoke_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare me uuid := private.require_user();
begin
  update public.share_invites set revoked_at = coalesce(revoked_at, now()) where id = p_invite_id and owner_id = me and accepted_at is null;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function public.share_set_role(p_member_id uuid, p_role text) returns void
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare me uuid := private.require_user(); m public.share_members;
begin
  if p_role not in ('editor', 'commenter', 'viewer') then raise exception 'invalid role' using errcode = '22023'; end if;
  select * into m from public.share_members where id = p_member_id and owner_id = me and revoked_at is null for update;
  if m.id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.share_members set role = p_role where id = p_member_id;
  perform private.log_activity(me, m.resource_kind, m.resource_id, me, 'role_changed', jsonb_build_object('member', m.label, 'role', p_role));
end $$;

create or replace function public.share_revoke_member(p_member_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare me uuid := private.require_user(); m public.share_members;
begin
  select * into m from public.share_members where id = p_member_id and owner_id = me and revoked_at is null for update;
  if m.id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.share_members set revoked_at = now() where id = p_member_id;
  perform private.log_activity(me, m.resource_kind, m.resource_id, me, 'access_revoked', jsonb_build_object('member', m.label));
end $$;

-- What the owner sees about a project's sharing. Never returns a token, a hash or an e-mail address.
create or replace function public.share_overview(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare me uuid := private.require_user();
begin
  if not private.owns_resource(p_kind, p_id, me) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'links', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'hasPassword', l.password_hash is not null, 'expiresAt', l.expires_at,
        'revokedAt', l.revoked_at, 'allowExport', l.allow_export, 'createdAt', l.created_at, 'openCount', l.open_count,
        'lastOpenedAt', l.last_opened_at, 'locked', coalesce(l.locked_until > now(), false)) order by l.created_at desc)
      from public.share_links l where l.owner_id = me and l.resource_kind = p_kind and l.resource_id = p_id), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'role', i.role, 'expiresAt', i.expires_at, 'acceptedAt', i.accepted_at,
        'revokedAt', i.revoked_at, 'createdAt', i.created_at) order by i.created_at desc)
      from public.share_invites i where i.owner_id = me and i.resource_kind = p_kind and i.resource_id = p_id), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'label', m.label, 'createdAt', m.created_at,
        'revokedAt', m.revoked_at) order by m.created_at)
      from public.share_members m where m.owner_id = me and m.resource_kind = p_kind and m.resource_id = p_id), '[]'::jsonb)
  );
end $$;

-- The documents a folder share would reach right now (shown BEFORE sharing, so nothing is exposed by surprise).
create or replace function public.share_preview_scope(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare me uuid := private.require_user();
begin
  if not private.owns_resource(p_kind, p_id, me) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind = 'document' then
    return jsonb_build_object('documents', jsonb_build_array(jsonb_build_object('id', p_id, 'title', private.resource_title('document', p_id))));
  end if;
  return jsonb_build_object('documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title) order by d.title)
    from public.documents d where d.id in (select private.documents_under(p_id))), '[]'::jsonb));
end $$;

create or replace function public.collab_activity(p_kind text, p_id uuid, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare me uuid := private.require_user(); allowed boolean;
begin
  if p_kind = 'document' then allowed := private.doc_role(p_id, me) in ('owner', 'editor', 'commenter');
  else allowed := private.owns_resource('node', p_id, me); end if;
  if not coalesce(allowed, false) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'detail', a.detail, 'createdAt', a.created_at,
      'actor', case when a.actor_id is null then null when a.actor_id = a.owner_id then 'owner' when a.actor_id = me then 'me' else
        coalesce((select m.label from public.share_members m where m.user_id = a.actor_id and m.owner_id = a.owner_id limit 1), 'Colaborador') end)
      order by a.id desc)
    from (select * from public.share_activity where resource_kind = p_kind and resource_id = p_id order by id desc limit greatest(1, least(p_limit, 200))) a), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- invitee

create or replace function public.share_accept_invite(p_token text, p_label text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare me uuid := private.require_user(); i public.share_invites; label text := left(coalesce(nullif(trim(p_label), ''), 'Colaborador'), 60);
begin
  select * into i from public.share_invites where token_hash = private.token_hash(p_token) for update;
  if i.id is null or i.revoked_at is not null or i.accepted_at is not null or i.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_used');
  end if;
  if i.owner_id = me then return jsonb_build_object('ok', false, 'reason', 'own_project'); end if;
  if not private.owns_resource(i.resource_kind, i.resource_id, i.owner_id) then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  insert into public.share_members(owner_id, resource_kind, resource_id, user_id, role, label)
  values (i.owner_id, i.resource_kind, i.resource_id, me, i.role, label)
  on conflict (resource_kind, resource_id, user_id) do update set role = excluded.role, label = excluded.label, revoked_at = null;
  update public.share_invites set accepted_by = me, accepted_at = now() where id = i.id;
  perform private.log_activity(i.owner_id, i.resource_kind, i.resource_id, me, 'invite_accepted', jsonb_build_object('role', i.role, 'member', label));
  return jsonb_build_object('ok', true, 'kind', i.resource_kind, 'id', i.resource_id, 'role', i.role, 'title', private.resource_title(i.resource_kind, i.resource_id));
end $$;

-- Everything shared with the caller: titles and roles only (content is fetched per document).
create or replace function public.shared_with_me() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare me uuid := private.require_user();
begin
  return jsonb_build_object(
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'role', r.role, 'updatedAt', d.updated_at) order by d.updated_at desc)
      from public.documents d cross join lateral (select private.doc_role(d.id, me) as role) r
      where d.owner_id <> me and r.role is not null and d.deleted_at is null), '[]'::jsonb),
    'folders', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'role', m.role) order by n.name)
      from public.share_members m join public.library_nodes n on n.id = m.resource_id and m.resource_kind = 'node'
      where m.user_id = me and m.revoked_at is null and n.deleted_at is null and n.owner_id = m.owner_id), '[]'::jsonb)
  );
end $$;


-- Which of MY projects are shared right now (counts only): drives the "shared" markers in the library.
create or replace function public.shared_by_me() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare me uuid := private.require_user();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('kind', s.resource_kind, 'id', s.resource_id, 'links', s.links, 'members', s.members, 'invites', s.invites))
    from (
      select r.resource_kind, r.resource_id,
        (select count(*) from public.share_links l where l.owner_id = me and l.resource_kind = r.resource_kind and l.resource_id = r.resource_id
           and l.revoked_at is null and (l.expires_at is null or l.expires_at > now())) as links,
        (select count(*) from public.share_members m where m.owner_id = me and m.resource_kind = r.resource_kind and m.resource_id = r.resource_id and m.revoked_at is null) as members,
        (select count(*) from public.share_invites i where i.owner_id = me and i.resource_kind = r.resource_kind and i.resource_id = r.resource_id
           and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()) as invites
      from (select resource_kind, resource_id from public.share_links where owner_id = me
            union select resource_kind, resource_id from public.share_members where owner_id = me
            union select resource_kind, resource_id from public.share_invites where owner_id = me) r
    ) s where s.links + s.members + s.invites > 0
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- collaboration on a document

create or replace function public.collab_pull_document(p_doc uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare me uuid := private.require_user(); role text := private.doc_role(p_doc, me); d public.documents;
begin
  if role is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into d from public.documents where id = p_doc;
  return jsonb_build_object('id', d.id, 'title', d.title, 'type', d.type, 'content', d.payload, 'rev', d.rev,
    'updatedAt', extract(epoch from d.updated_at) * 1000, 'role', role);
end $$;

-- Compare-and-swap save: only editors and the owner; on a revision mismatch NOTHING is written and the current
-- version is returned so the client can merge. Idempotent per op id. Keeps a recovery version (author recorded).
create or replace function public.collab_save_document(p_doc uuid, p_base_rev bigint, p_title text, p_content jsonb, p_op_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  me uuid := private.require_user(); role text; d public.documents; cached jsonb; cursor_value bigint; result jsonb;
  last_version timestamptz;
begin
  select owner_id into d.owner_id from public.documents where id = p_doc;
  if d.owner_id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  -- Lock order matches the private sync (cursor row, then document) so the two can never deadlock.
  insert into public.sync_cursors(owner_id) values (d.owner_id) on conflict do nothing;
  perform 1 from public.sync_cursors where owner_id = d.owner_id for update;
  select * into d from public.documents where id = p_doc for update;
  role := private.doc_role(p_doc, me);
  if role is null or role not in ('owner', 'editor') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' or char_length(p_content::text) > 4000000 then
    raise exception 'invalid content' using errcode = '22023';
  end if;
  select c.result into cached from public.collab_ops c where c.op_id = p_op_id and c.actor_id = me;
  if cached is not null then return cached; end if;
  if d.rev <> p_base_rev then
    return jsonb_build_object('conflict', true, 'current', jsonb_build_object('title', d.title, 'content', d.payload, 'rev', d.rev,
      'updatedAt', extract(epoch from d.updated_at) * 1000));
  end if;
  select max(v.created_at) into last_version from public.document_versions v where v.document_id = p_doc and v.author_id = me and v.reason = 'collab';
  if last_version is null or last_version < now() - interval '2 minutes' then
    insert into public.document_versions(id, owner_id, document_id, reason, title, payload, created_at, author_id)
    values (gen_random_uuid(), d.owner_id, p_doc, 'collab', d.title, d.payload, now(), me);
  end if;
  update public.documents set title = coalesce(nullif(trim(p_title), ''), title), payload = p_content, rev = rev + 1, updated_at = now()
  where id = p_doc returning * into d;
  -- The owner's other devices learn about the change through the private sync log.
  update public.sync_cursors set value = value + 1 where owner_id = d.owner_id returning value into cursor_value;
  insert into public.sync_changes(owner_id, cursor, kind, record)
  values (d.owner_id, cursor_value, 'document', jsonb_build_object('id', d.id, 'nodeId', d.node_id, 'songId', d.song_id, 'type', d.type,
    'title', d.title, 'content', d.payload, 'rev', d.rev, 'deletedAt', null, 'createdAt', extract(epoch from d.updated_at) * 1000,
    'updatedAt', extract(epoch from d.updated_at) * 1000, 'ownerId', d.owner_id, 'lastOpId', p_op_id));
  perform private.log_activity(d.owner_id, 'document', p_doc, me, 'edited', jsonb_build_object('rev', d.rev));
  result := jsonb_build_object('conflict', false, 'rev', d.rev, 'updatedAt', extract(epoch from d.updated_at) * 1000);
  insert into public.collab_ops(op_id, document_id, actor_id, result) values (p_op_id, p_doc, me, result);
  return result;
end $$;

-- Commenters (and editors, and the owner) may add a comment and nothing else: the function appends exactly one
-- validated comment and never touches the rest of the document.
create or replace function public.collab_add_comment(p_doc uuid, p_comment jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare me uuid := private.require_user(); role text; d public.documents; cursor_value bigint; clean jsonb;
begin
  select owner_id into d.owner_id from public.documents where id = p_doc;
  if d.owner_id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.sync_cursors(owner_id) values (d.owner_id) on conflict do nothing;
  perform 1 from public.sync_cursors where owner_id = d.owner_id for update;
  select * into d from public.documents where id = p_doc for update;
  role := private.doc_role(p_doc, me);
  if role is null or role not in ('owner', 'editor', 'commenter') then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_comment) <> 'object' or char_length(coalesce(p_comment->>'text', '')) not between 1 and 4000 then
    raise exception 'invalid comment' using errcode = '22023';
  end if;
  clean := jsonb_build_object('id', coalesce(p_comment->>'id', gen_random_uuid()::text), 'text', p_comment->>'text',
    'createdAt', coalesce((p_comment->>'createdAt')::double precision, extract(epoch from now()) * 1000),
    'updatedAt', coalesce((p_comment->>'updatedAt')::double precision, extract(epoch from now()) * 1000));
  if p_comment ? 'blockId' then clean := clean || jsonb_build_object('blockId', p_comment->>'blockId'); end if;
  if p_comment ? 'eventId' then clean := clean || jsonb_build_object('eventId', p_comment->>'eventId'); end if;
  update public.documents set payload = jsonb_set(case when jsonb_typeof(payload) = 'object' then payload else '{}'::jsonb end, '{comments}',
      coalesce(payload->'comments', '[]'::jsonb) || jsonb_build_array(clean)), rev = rev + 1, updated_at = now()
  where id = p_doc returning * into d;
  update public.sync_cursors set value = value + 1 where owner_id = d.owner_id returning value into cursor_value;
  insert into public.sync_changes(owner_id, cursor, kind, record)
  values (d.owner_id, cursor_value, 'document', jsonb_build_object('id', d.id, 'nodeId', d.node_id, 'songId', d.song_id, 'type', d.type,
    'title', d.title, 'content', d.payload, 'rev', d.rev, 'deletedAt', null, 'createdAt', extract(epoch from d.updated_at) * 1000,
    'updatedAt', extract(epoch from d.updated_at) * 1000, 'ownerId', d.owner_id, 'lastOpId', gen_random_uuid()));
  perform private.log_activity(d.owner_id, 'document', p_doc, me, 'commented');
  return jsonb_build_object('rev', d.rev);
end $$;

-- ---------------------------------------------------------------- public link gateway (anon allowed)

-- Safe to call without a password: reveals only whether the link works and whether it needs a password.
create or replace function public.share_link_info(p_token text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare l public.share_links; scope_ok boolean;
begin
  select * into l from public.share_links where token_hash = private.token_hash(p_token);
  if l.id is null then return jsonb_build_object('valid', false, 'reason', 'invalid'); end if;
  if l.revoked_at is not null then return jsonb_build_object('valid', false, 'reason', 'revoked'); end if;
  if l.expires_at is not null and l.expires_at <= now() then return jsonb_build_object('valid', false, 'reason', 'expired'); end if;
  scope_ok := private.owns_resource(l.resource_kind, l.resource_id, l.owner_id);
  if not scope_ok then return jsonb_build_object('valid', false, 'reason', 'gone'); end if;
  return jsonb_build_object('valid', true, 'requiresPassword', l.password_hash is not null, 'kind', l.resource_kind,
    'title', private.resource_title(l.resource_kind, l.resource_id), 'locked', coalesce(l.locked_until > now(), false));
end $$;

-- Verifies the password on the server. Failures are counted per link; five in a row lock it for 15 minutes. Results
-- are returned (not raised) so the counter is committed. The session token is random, shown once, stored hashed.
create or replace function public.share_unlock(p_token text, p_password text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions
as $$
declare l public.share_links; session_token text := private.new_token();
begin
  select * into l from public.share_links where token_hash = private.token_hash(p_token) for update;
  if l.id is null or l.revoked_at is not null or (l.expires_at is not null and l.expires_at <= now()) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if l.password_hash is null then return jsonb_build_object('ok', true, 'session', null); end if;
  if l.locked_until is not null and l.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'retryAfterSeconds', ceil(extract(epoch from (l.locked_until - now()))));
  end if;
  if p_password is not null and extensions.crypt(p_password, l.password_hash) = l.password_hash then
    update public.share_links set failed_attempts = 0, locked_until = null where id = l.id;
    insert into public.share_sessions(token_hash, link_id, expires_at) values (private.token_hash(session_token), l.id, now() + interval '2 hours');
    delete from public.share_sessions where expires_at < now();
    return jsonb_build_object('ok', true, 'session', session_token);
  end if;
  perform pg_sleep(0.25);
  update public.share_links set
    locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end,
    failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end
  where id = l.id;
  return jsonb_build_object('ok', false, 'reason', 'wrong_password');
end $$;

-- The only way to read a shared project without an account. Content is returned only after the link is valid and,
-- when protected, a valid unlock session was presented. Comments are never included.
create or replace function public.share_read(p_token text, p_session text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare l public.share_links; authorized boolean := false; docs jsonb;
begin
  select * into l from public.share_links where token_hash = private.token_hash(p_token);
  if l.id is null or l.revoked_at is not null or (l.expires_at is not null and l.expires_at <= now())
     or not private.owns_resource(l.resource_kind, l.resource_id, l.owner_id) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if l.password_hash is null then authorized := true;
  else
    authorized := p_session is not null and exists (select 1 from public.share_sessions s
      where s.token_hash = private.token_hash(p_session) and s.link_id = l.id and s.expires_at > now());
  end if;
  if not authorized then return jsonb_build_object('ok', false, 'reason', 'password_required'); end if;
  update public.share_links set open_count = open_count + 1, last_opened_at = now() where id = l.id;
  if l.resource_kind = 'document' then
    select jsonb_build_array(jsonb_build_object('id', d.id, 'title', d.title, 'type', d.type, 'content', private.public_content(d.payload)))
      into docs from public.documents d where d.id = l.resource_id;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'type', d.type, 'content', private.public_content(d.payload)) order by d.title), '[]'::jsonb)
      into docs from public.documents d where d.id in (select private.documents_under(l.resource_id));
  end if;
  return jsonb_build_object('ok', true, 'kind', l.resource_kind, 'title', private.resource_title(l.resource_kind, l.resource_id),
    'allowExport', l.allow_export, 'documents', coalesce(docs, '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- grants: nothing is executable by default

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'share\_%' escape '\' or p.proname like 'collab\_%' escape '\' or p.proname in ('shared_with_me', 'shared_by_me')) loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.share_create_link(text, uuid, text, timestamptz, boolean) to authenticated;
grant execute on function public.share_update_link(uuid, text, boolean, timestamptz, boolean, boolean) to authenticated;
grant execute on function public.share_revoke_link(uuid) to authenticated;
grant execute on function public.share_create_invite(text, uuid, text, timestamptz) to authenticated;
grant execute on function public.share_revoke_invite(uuid) to authenticated;
grant execute on function public.share_set_role(uuid, text) to authenticated;
grant execute on function public.share_revoke_member(uuid) to authenticated;
grant execute on function public.share_overview(text, uuid) to authenticated;
grant execute on function public.share_preview_scope(text, uuid) to authenticated;
grant execute on function public.collab_activity(text, uuid, int) to authenticated;
grant execute on function public.share_accept_invite(text, text) to authenticated;
grant execute on function public.shared_with_me() to authenticated;
grant execute on function public.shared_by_me() to authenticated;
grant execute on function public.collab_pull_document(uuid) to authenticated;
grant execute on function public.collab_save_document(uuid, bigint, text, jsonb, uuid) to authenticated;
grant execute on function public.collab_add_comment(uuid, jsonb) to authenticated;
grant execute on function public.share_link_info(text) to anon, authenticated;
grant execute on function public.share_unlock(text, text) to anon, authenticated;
grant execute on function public.share_read(text, text) to anon, authenticated;

-- A cheap capability probe so the app can tell, without side effects, whether sharing is installed.
create or replace function public.collab_capabilities() returns jsonb
language sql stable security definer set search_path = pg_catalog
as $$ select jsonb_build_object('sharing', 1) $$;
revoke execute on function public.collab_capabilities() from public;
grant execute on function public.collab_capabilities() to anon, authenticated;
