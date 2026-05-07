import { z } from 'zod';

const TMP_PATH = z.string().regex(/^\/tmp\/[A-Za-z0-9_./-]+$/, '/tmp/<safe-name>');

export const banadiExecInput = {
  argv: z.array(z.string().min(1)).min(1),
  timeout_ms: z.number().int().positive().max(600000).optional(),
  container: z.string().min(1).optional(),
};

export const banadiCurlInput = {
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  max_time: z.number().int().positive().max(600).optional(),
};

export const banadiWriteTmpInput = {
  path: TMP_PATH,
  body: z.string(),
};

export const banadiReadTmpInput = {
  path: TMP_PATH,
  max_bytes: z.number().int().positive().max(10485760).optional(),
};

export const nvdCveInput = {
  id: z.string().regex(/^CVE-\d{4}-\d{4,}$/i, 'CVE-YYYY-NNNN[N…]'),
};

export const nvdSearchInput = {
  cpe: z.string().startsWith('cpe:'),
  version: z.string().optional(),
};

export const nvdCvesForServiceInput = {
  service: z.string().min(1),
  version: z.string().min(1),
  os: z.string().optional(),
};
