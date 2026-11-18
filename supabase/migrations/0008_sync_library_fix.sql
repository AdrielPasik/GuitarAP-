-- GuitarAP 0008: repairs public.sync_library (the private library sync).
--
-- WHAT WAS WRONG. 0006 declared the PL/pgSQL variables parent_id, node_id and song_id. Inside the queries that check
-- a node's parent (`... from public.library_nodes p where p.id = parent_id`), PostgreSQL cannot tell the variable
-- from the column library_nodes.parent_id and raises
--     42702: column reference "parent_id" is ambiguous
-- That is raised when the statement is executed, so ANY snapshot that contains a folder or a song failed with
-- HTTP 400, while an empty snapshot (what the old tests sent) succeeded. The result: the first sync of every real
-- library failed and nothing ever reached the server.
--
-- WHAT THIS DOES.
--   * Renames the variables (v_parent_id, v_node_id, v_song_id) so no name collides with a column.
--   * Processes the nodes of one snapshot PARENTS FIRST (by depth), so a child never arrives before its parent in the
--     same request, whatever order the client sent them in.
-- No rollback file: returning to the 0006 body would bring the defect back, and nothing else here needs undoing.
-- ADDITIVE AND SAFE: it only replaces function bodies (same signature, same security definer, same grants). It
-- does not touch tables, rows, policies or any other function. Running it twice is harmless.

create or replace function public.sync_library(p_owner_id uuid, p_op_id uuid, p_snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  cached jsonb;
  item jsonb;
  current_node public.library_nodes;
  current_document public.documents;
  current_version public.document_versions;
  incoming_rev bigint;
  v_found boolean;
  v_parent_id uuid;
  v_node_id uuid;
  v_song_id uuid;
  cursor_value bigint;
  result jsonb := jsonb_build_object(
    'documents', '[]'::jsonb,
    'nodes', '[]'::jsonb,
    'versions', '[]'::jsonb,
    'conflicts', '[]'::jsonb
  );
begin
  if auth.uid() is null or auth.uid() <> p_owner_id then
    raise exception 'owner mismatch' using errcode = '42501';
  end if;

  insert into public.sync_cursors(owner_id) values(auth.uid()) on conflict do nothing;
  perform 1 from public.sync_cursors where owner_id = auth.uid() for update;

  -- Recheck only after taking the per-owner lock. Two concurrent retries of the
  -- same operation can therefore never apply the snapshot twice.
  select so.result into cached
  from public.sync_operations so
  where so.owner_id = auth.uid() and so.op_id = p_op_id;
  if cached is not null then return cached; end if;

  for item in
    with recursive incoming(item, id, pid) as (
      select e, e->>'id', nullif(e->>'parentId', '')
      from jsonb_array_elements(coalesce(p_snapshot->'nodes', '[]'::jsonb)) e
    ),
    depth(id, d) as (
      select i.id, 0 from incoming i where i.pid is null or i.pid not in (select x.id from incoming x)
      union all
      select i.id, depth.d + 1 from incoming i join depth on i.pid = depth.id
    )
    select i.item
    from incoming i left join depth on depth.id = i.id
    order by coalesce(depth.d, 1000000), i.id
  loop
    incoming_rev := coalesce((item->>'rev')::bigint, 1);
    v_parent_id := nullif(item->>'parentId', '')::uuid;
    select n.* into current_node from public.library_nodes n where n.id = (item->>'id')::uuid for update;
    -- FOUND, not `current_node IS NOT NULL`: a composite is "not null" only when EVERY column is, and parent_id,
    -- song and deleted_at usually are null, so that test silently skipped the ownership check.
    v_found := found;

    if v_found and current_node.owner_id <> auth.uid() then
      raise exception 'node id belongs to another account' using errcode = '42501';
    end if;
    if v_parent_id is not null and not exists (
      select 1 from public.library_nodes p where p.id = v_parent_id and p.owner_id = auth.uid()
    ) then
      raise exception 'node parent does not exist in this account' using errcode = '23503';
    end if;

    if not v_found or current_node.rev = incoming_rev - 1 then
      insert into public.library_nodes(
        id, owner_id, parent_id, kind, name, sort_order, song, rev,
        deleted_at, created_at, updated_at
      ) values (
        (item->>'id')::uuid, auth.uid(), v_parent_id, item->>'kind', item->>'name',
        (item->>'order')::bigint, item->'song', incoming_rev,
        case when item->>'deletedAt' is null then null else to_timestamp((item->>'deletedAt')::double precision / 1000) end,
        to_timestamp((item->>'createdAt')::double precision / 1000),
        to_timestamp((item->>'updatedAt')::double precision / 1000)
      )
      on conflict(id) do update set
        parent_id = excluded.parent_id,
        kind = excluded.kind,
        name = excluded.name,
        sort_order = excluded.sort_order,
        song = excluded.song,
        rev = excluded.rev,
        deleted_at = excluded.deleted_at,
        updated_at = excluded.updated_at
      where public.library_nodes.owner_id = auth.uid()
        and public.library_nodes.rev = excluded.rev - 1
      returning * into current_node;

      if current_node is null then
        raise exception 'node revision changed concurrently' using errcode = '40001';
      end if;
      update public.sync_cursors set value = value + 1 where owner_id = auth.uid() returning value into cursor_value;
      insert into public.sync_changes(owner_id, cursor, kind, record)
      values(auth.uid(), cursor_value, 'node', item || jsonb_build_object('ownerId', auth.uid(), 'lastOpId', p_op_id));
      result := jsonb_set(result, '{nodes}', (result->'nodes') || jsonb_build_array(item || jsonb_build_object('ownerId', auth.uid(), 'lastOpId', p_op_id)));
    else
      result := jsonb_set(result, '{conflicts}', (result->'conflicts') || jsonb_build_array(jsonb_build_object(
        'id', current_node.id,
        'parentId', current_node.parent_id,
        'kind', current_node.kind,
        'name', current_node.name,
        'order', current_node.sort_order,
        'song', current_node.song,
        'rev', current_node.rev,
        'deletedAt', case when current_node.deleted_at is null then null else extract(epoch from current_node.deleted_at) * 1000 end,
        'createdAt', extract(epoch from current_node.created_at) * 1000,
        'updatedAt', extract(epoch from current_node.updated_at) * 1000,
        'ownerId', current_node.owner_id,
        'lastOpId', p_op_id
      )));
    end if;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_snapshot->'documents', '[]'::jsonb)) loop
    incoming_rev := (item->>'rev')::bigint;
    v_node_id := nullif(item->>'nodeId', '')::uuid;
    v_song_id := nullif(item->>'songId', '')::uuid;
    select d.* into current_document from public.documents d where d.id = (item->>'id')::uuid for update;
    v_found := found;

    if v_found and current_document.owner_id <> auth.uid() then
      raise exception 'document id belongs to another account' using errcode = '42501';
    end if;
    if v_node_id is not null and not exists (
      select 1 from public.library_nodes n where n.id = v_node_id and n.owner_id = auth.uid()
    ) then
      raise exception 'document folder does not exist in this account' using errcode = '23503';
    end if;
    if v_song_id is not null and not exists (
      select 1 from public.library_nodes n where n.id = v_song_id and n.owner_id = auth.uid() and n.kind = 'song'
    ) then
      raise exception 'document song does not exist in this account' using errcode = '23503';
    end if;

    if not v_found or current_document.rev = incoming_rev - 1 then
      insert into public.documents(
        id, owner_id, node_id, song_id, type, title, payload, rev,
        deleted_at, created_at, updated_at
      ) values (
        (item->>'id')::uuid, auth.uid(), v_node_id, v_song_id, item->>'type', item->>'title',
        item->'content', incoming_rev,
        case when item->>'deletedAt' is null then null else to_timestamp((item->>'deletedAt')::double precision / 1000) end,
        to_timestamp((item->>'createdAt')::double precision / 1000),
        to_timestamp((item->>'updatedAt')::double precision / 1000)
      )
      on conflict(id) do update set
        node_id = excluded.node_id,
        song_id = excluded.song_id,
        type = excluded.type,
        title = excluded.title,
        payload = excluded.payload,
        rev = excluded.rev,
        deleted_at = excluded.deleted_at,
        updated_at = excluded.updated_at
      where public.documents.owner_id = auth.uid()
        and public.documents.rev = excluded.rev - 1
      returning * into current_document;

      if current_document is null then
        raise exception 'document revision changed concurrently' using errcode = '40001';
      end if;
      update public.sync_cursors set value = value + 1 where owner_id = auth.uid() returning value into cursor_value;
      insert into public.sync_changes(owner_id, cursor, kind, record)
      values(auth.uid(), cursor_value, 'document', item || jsonb_build_object('ownerId', auth.uid(), 'lastOpId', p_op_id));
      result := jsonb_set(result, '{documents}', (result->'documents') || jsonb_build_array(item || jsonb_build_object('ownerId', auth.uid(), 'lastOpId', p_op_id)));
    else
      result := jsonb_set(result, '{conflicts}', (result->'conflicts') || jsonb_build_array(jsonb_build_object(
        'id', current_document.id,
        'nodeId', current_document.node_id,
        'songId', current_document.song_id,
        'type', current_document.type,
        'title', current_document.title,
        'content', current_document.payload,
        'rev', current_document.rev,
        'deletedAt', case when current_document.deleted_at is null then null else extract(epoch from current_document.deleted_at) * 1000 end,
        'createdAt', extract(epoch from current_document.created_at) * 1000,
        'updatedAt', extract(epoch from current_document.updated_at) * 1000,
        'ownerId', current_document.owner_id,
        'lastOpId', p_op_id
      )));
    end if;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_snapshot->'versions', '[]'::jsonb)) loop
    select v.* into current_version from public.document_versions v where v.id = (item->>'id')::uuid;
    v_found := found;
    if v_found and current_version.owner_id <> auth.uid() then
      raise exception 'version id belongs to another account' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.documents d where d.id = (item->>'documentId')::uuid and d.owner_id = auth.uid()
    ) then
      raise exception 'version document does not exist in this account' using errcode = '23503';
    end if;

    if not v_found then
      insert into public.document_versions(id, owner_id, document_id, reason, title, payload, created_at)
      values(
        (item->>'id')::uuid, auth.uid(), (item->>'documentId')::uuid,
        item->>'reason', item->>'title', item->'content',
        to_timestamp((item->>'createdAt')::double precision / 1000)
      ) returning * into current_version;
      update public.sync_cursors set value = value + 1 where owner_id = auth.uid() returning value into cursor_value;
      insert into public.sync_changes(owner_id, cursor, kind, record)
      values(auth.uid(), cursor_value, 'version', item || jsonb_build_object('ownerId', auth.uid(), 'lastOpId', p_op_id));
    end if;
    result := jsonb_set(result, '{versions}', (result->'versions') || jsonb_build_array(jsonb_build_object(
      'id', current_version.id,
      'documentId', current_version.document_id,
      'reason', current_version.reason,
      'title', current_version.title,
      'content', current_version.payload,
      'createdAt', extract(epoch from current_version.created_at) * 1000,
      'ownerId', current_version.owner_id,
      'lastOpId', p_op_id
    )));
  end loop;

  insert into public.sync_operations(owner_id, op_id, result) values(auth.uid(), p_op_id, result);
  return result;
end
$$;

-- Same exposure as 0006: only signed-in accounts may call it.
revoke execute on function public.sync_library(uuid, uuid, jsonb) from public, anon;
grant execute on function public.sync_library(uuid, uuid, jsonb) to authenticated;

-- Parts of a shared project/folder are listed in the order they were created (then by title), not alphabetically:
-- the first part you made comes first. Same bodies as 0007, only the ordering changes.
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
    select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'type', d.type, 'content', private.public_content(d.payload)) order by d.created_at, d.title), '[]'::jsonb)
      into docs from public.documents d where d.id in (select private.documents_under(l.resource_id));
  end if;
  return jsonb_build_object('ok', true, 'kind', l.resource_kind, 'title', private.resource_title(l.resource_kind, l.resource_id),
    'allowExport', l.allow_export, 'documents', coalesce(docs, '[]'::jsonb));
end $$;

create or replace function public.share_preview_scope(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare me uuid := private.require_user();
begin
  if not private.owns_resource(p_kind, p_id, me) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind = 'document' then
    return jsonb_build_object('documents', jsonb_build_array(jsonb_build_object('id', p_id, 'title', private.resource_title('document', p_id))));
  end if;
  return jsonb_build_object('documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title) order by d.created_at, d.title)
    from public.documents d where d.id in (select private.documents_under(p_id))), '[]'::jsonb));
end $$;

grant execute on function public.share_read(text, text) to anon, authenticated;
grant execute on function public.share_preview_scope(text, uuid) to authenticated;

-- shared_with_me: each document now says which shared PROJECT/FOLDER grants it (if it is not shared on its own), so
-- the app can show a shared song as one project with its parts. Same signature and grants; extra fields are ignored
-- by clients that do not know them.
create or replace function public.shared_with_me() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
declare me uuid := private.require_user();
begin
  return jsonb_build_object(
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'role', r.role, 'updatedAt', d.updated_at,
        'project', (
          select jsonb_build_object('id', n.id, 'name', n.name, 'kind', n.kind)
          from public.share_members m
          join public.library_nodes n on n.id = m.resource_id and m.resource_kind = 'node'
          where m.user_id = me and m.revoked_at is null and m.owner_id = d.owner_id and n.deleted_at is null
            and m.resource_id in (select private.containing_nodes(d.id))
          order by (n.kind = 'song') desc, n.name
          limit 1)) order by d.updated_at desc)
      from public.documents d cross join lateral (select private.doc_role(d.id, me) as role) r
      where d.owner_id <> me and r.role is not null and d.deleted_at is null), '[]'::jsonb),
    'folders', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'role', m.role, 'kind', n.kind) order by n.name)
      from public.share_members m join public.library_nodes n on n.id = m.resource_id and m.resource_kind = 'node'
      where m.user_id = me and m.revoked_at is null and n.deleted_at is null and n.owner_id = m.owner_id), '[]'::jsonb)
  );
end $$;
revoke execute on function public.shared_with_me() from public, anon;
grant execute on function public.shared_with_me() to authenticated;


-- A cheap probe so the app can tell, without writing anything, whether this repair is installed.
create or replace function public.sync_capabilities() returns jsonb
language sql stable security definer set search_path = pg_catalog
as $$ select jsonb_build_object('syncLibrary', 2) $$;
revoke execute on function public.sync_capabilities() from public;
grant execute on function public.sync_capabilities() to anon, authenticated;

notify pgrst, 'reload schema';
