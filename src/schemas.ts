import { z } from '@hono/zod-openapi';

// -- Cell types (aligned with grid-apiary-llm-fusion CellInfo) --

export const CellTypeSchema = z.enum(['z', 'b', 'n', 's', 'e']);

export const CellInfoSchema = z.object({
  v: z.union([z.number(), z.string(), z.boolean()]).optional(),
  f: z.string().optional(),
  t: CellTypeSchema.optional(),
  ref: z.string().optional(),
  num_format: z.string().optional(),
  style_index: z.number().int().optional(),
  formatted: z.string().optional(),
});

// Single cell: CellInfo, range: Record<ref, CellInfo>
export const ReadResultSchema = z.union([
  CellInfoSchema,
  z.record(z.string(), CellInfoSchema),
]);

// -- Query --

export const QueryRequestSchema = z.object({
  apply: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  read: z.array(z.string()).min(1),
});

export const QueryResponseSchema = z.record(z.string(), ReadResultSchema);

// -- Workbook --

export const WorkbookInfoSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  modified: z.string().datetime(),
  status: z.enum(['hot', 'cold', 'error']),
});

export const UploadResponseSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  modified: z.string().datetime(),
});

export const ErrorResponseSchema = z.object({
  error: z.string(),
});
