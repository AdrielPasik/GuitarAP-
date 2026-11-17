-- Rollback for 0007_sharing.sql. Removes ONLY what 0007 added. Libraries, documents, versions and the private sync
-- tables are not touched (the nullable document_versions.author_id column is left in place: dropping it would
-- discard authorship of history rows and nothing depends on it).
--
-- Run this only if you want to remove sharing entirely. Existing share links, invitations and memberships are
-- deleted by it, which also ends every collaborator's access.

drop function if exists public.collab_capabilities();
drop function if exists public.share_read(text, text);
drop function if exists public.share_unlock(text, text);
drop function if exists public.share_link_info(text);
drop function if exists public.collab_add_comment(uuid, jsonb);
drop function if exists public.collab_save_document(uuid, bigint, text, jsonb, uuid);
drop function if exists public.collab_pull_document(uuid);
drop function if exists public.shared_by_me();
drop function if exists public.shared_with_me();
drop function if exists public.share_accept_invite(text, text);
drop function if exists public.collab_activity(text, uuid, int);
drop function if exists public.share_preview_scope(text, uuid);
drop function if exists public.share_overview(text, uuid);
drop function if exists public.share_revoke_member(uuid);
drop function if exists public.share_set_role(uuid, text);
drop function if exists public.share_revoke_invite(uuid);
drop function if exists public.share_create_invite(text, uuid, text, timestamptz);
drop function if exists public.share_revoke_link(uuid);
drop function if exists public.share_update_link(uuid, text, boolean, timestamptz, boolean, boolean);
drop function if exists public.share_create_link(text, uuid, text, timestamptz, boolean);

drop function if exists private.note_unlock_failure(bytea);
drop function if exists private.client_ip_hash();
drop function if exists private.public_content(jsonb);
drop function if exists private.documents_under(uuid);
drop function if exists private.resource_title(text, uuid);
drop function if exists private.owns_resource(text, uuid, uuid);
drop function if exists private.doc_role(uuid, uuid);
drop function if exists private.containing_nodes(uuid);
drop function if exists private.log_activity(uuid, text, uuid, uuid, text, jsonb);
drop function if exists private.require_user();
drop function if exists private.token_hash(text);
drop function if exists private.new_token();

drop table if exists public.share_unlock_ip;
drop table if exists public.collab_ops;
drop table if exists public.share_activity;
drop table if exists public.share_sessions;
drop table if exists public.share_links;
drop table if exists public.share_invites;
drop table if exists public.share_members;

notify pgrst, 'reload schema';
