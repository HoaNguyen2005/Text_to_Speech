ALTER TABLE voices ADD COLUMN class text NOT NULL DEFAULT 'free' CHECK (class IN ('free','gold','diamond'));
ALTER TABLE voices ADD COLUMN description text NOT NULL DEFAULT '' CHECK (length(description) <= 500);
ALTER TABLE users ADD COLUMN account_class text NOT NULL DEFAULT 'free' CHECK (account_class IN ('free','gold','diamond'));
ALTER TABLE users ADD COLUMN profile_version integer NOT NULL DEFAULT 0 CHECK (profile_version >= 0);
