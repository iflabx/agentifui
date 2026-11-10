BEGIN;

CREATE TABLE IF NOT EXISTS public.auth_sso_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer TEXT NOT NULL,
  oidc_config TEXT,
  saml_config TEXT,
  user_id UUID NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL UNIQUE,
  organization_id TEXT,
  domain TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sso_providers_user_id
  ON public.auth_sso_providers(user_id);

COMMIT;
