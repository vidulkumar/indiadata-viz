import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || 'https://vdcxpatuospplgpcsonn.supabase.co';
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_rWQBriNhmU31mwH0lN9ZPg_hbYIx8t3';

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
