-- Restores password sign-in.
--
-- Run this if your database was migrated to the passwordless scheme. The column
-- is added as nullable because existing rows have no hash: any account created
-- during the passwordless period can't sign in and should be deleted (the books
-- and highlights attached to it go with it).

alter table app_users add column if not exists password_hash text;

-- Accounts with no password can never authenticate. Remove them if you want a
-- clean slate — this deletes their books, highlights and notes too:
-- delete from app_users where password_hash is null;
