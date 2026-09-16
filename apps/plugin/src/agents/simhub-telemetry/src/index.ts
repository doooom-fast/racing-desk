import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_URL = 'http://localhost:8889/racecor-io-pro-drive/';

// Cache latest telemetry for list_telemetry_fields
let lastTelemetry: Record<string, any> = {};

// Telemetry catalog types
interface CatalogField {
  name: string;
  type: string;
  unit?: string;
  range?: string;
  wired: boolean;
  desc: string;
  deprecated?: boolean;
  liveOnly?: boolean;
  diskOnly?: boolean;
}

interface CatalogSection {
  id: string;
  title: string;
  source: string;
  fields: CatalogField[];
}

interface TelemetryCatalog {
  version: string;
  description: string;
  sources: Record<string, string>;
  sections: CatalogSection[];
}

// Load and cache the telemetry catalog
let catalogCache: TelemetryCatalog | null = null;

async function loadCatalog(): Promise<TelemetryCatalog> {
  if (catalogCache) return catalogCache;
  const catalogPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'telemetry-catalog.json');
  const content = await readFile(catalogPath, 'utf-8');
  catalogCache = JSON.parse(content) as TelemetryCatalog;
  return catalogCache;
}

const server = new Server(
  {
    name: 'simhub-telemetry',
    version: '1.0.0',
  },
  {
    capabilities: { tools: {} },
  }
);

/**
 * Fetches telemetry from SimHub API
 */
async function fetchTelemetry(url: string): Promise<Record<string, any>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    lastTelemetry = data;
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Flattens nested object into dot-notation keys
 */
function flattenObject(
  obj: Record<string, any>,
  prefix: string = ''
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, newKey));
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

/**
 * Lists all available telemetry keys
 */
function getTelemetryKeys(filter?: string): string[] {
  const flat = flattenObject(lastTelemetry);
  let keys = Object.keys(flat).sort();

  if (filter) {
    try {
      const regex = new RegExp(filter, 'i');
      keys = keys.filter((k) => regex.test(k));
    } catch (e) {
      throw new Error(`Invalid regex filter: ${filter}`);
    }
  }

  return keys;
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_telemetry',
      description:
        'Fetch full telemetry snapshot from SimHub plugin API. Returns the complete JSON response.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: {
            type: 'string',
            description:
              'SimHub API URL (default: http://localhost:8889/racecor-io-pro-drive/)',
          },
        },
      },
    },
    {
      name: 'get_telemetry_field',
      description:
        'Get a specific telemetry field value by property key (dot notation, e.g., DataCorePlugin.GameData.Position)',
      inputSchema: {
        type: 'object' as const,
        properties: {
          field: {
            type: 'string',
            description: 'The property key in dot notation',
          },
          url: {
            type: 'string',
            description:
              'SimHub API URL (default: http://localhost:8889/racecor-io-pro-drive/)',
          },
        },
        required: ['field'],
      },
    },
    {
      name: 'list_telemetry_fields',
      description:
        'List all available telemetry property keys from the last fetch. Optionally filter by regex pattern.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          filter: {
            type: 'string',
            description: 'Optional regex pattern to filter keys',
          },
        },
      },
    },
    {
      name: 'check_connection',
      description:
        'Test connectivity to the SimHub API. Returns status, response time, and property count.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: {
            type: 'string',
            description:
              'SimHub API URL (default: http://localhost:8889/racecor-io-pro-drive/)',
          },
        },
      },
    },
    {
      name: 'get_telemetry_reference',
      description:
        'Query the complete telemetry reference catalog (~300+ fields across iRacing SDK, SimHub GameData, K10 plugin outputs, and commentary triggers). Returns field metadata including type, unit, range, wired status, and description. Use this to understand what telemetry data is available before building features.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          section: {
            type: 'string',
            description:
              'Optional section ID to filter by (e.g., "iracing-speed-engine", "simhub-gd-core", "k10-plugin-outputs"). Omit to get all sections.',
          },
          filter: {
            type: 'string',
            description:
              'Optional regex pattern to search across field names, descriptions, types, and units.',
          },
          wiredOnly: {
            type: 'boolean',
            description:
              'If true, only return fields that are currently wired into TelemetrySnapshot (actively captured by the plugin).',
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const toolArgs = args as Record<string, string | undefined>;

  try {
    switch (name) {
      case 'get_telemetry': {
        const url = toolArgs.url || DEFAULT_URL;
        const data = await fetchTelemetry(url);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'get_telemetry_field': {
        const field = toolArgs.field;
        if (!field) throw new Error('field parameter is required');

        const url = toolArgs.url || DEFAULT_URL;
        const data = await fetchTelemetry(url);
        const flat = flattenObject(data);

        if (!(field in flat)) {
          return {
            content: [
              {
                type: 'text',
                text: `Field "${field}" not found. Available fields: ${Object.keys(flat).join(', ')}`,
              },
            ],
          };
        }

        const value = flat[field];
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ field, value }, null, 2),
            },
          ],
        };
      }

      case 'list_telemetry_fields': {
        const filter = toolArgs.filter;
        const keys = getTelemetryKeys(filter);

        if (keys.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No telemetry fields available or no matches for filter.',
              },
            ],
          };
        }

        const flat = flattenObject(lastTelemetry);
        const fieldsWithValues = keys.map((key) => ({
          key,
          value: flat[key],
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(fieldsWithValues, null, 2),
            },
          ],
        };
      }

      case 'check_connection': {
        const url = toolArgs.url || DEFAULT_URL;
        const startTime = Date.now();

        try {
          const data = await fetchTelemetry(url);
          const responseTime = Date.now() - startTime;
          const flat = flattenObject(data);
          const propertyCount = Object.keys(flat).length;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: 'connected',
                    url,
                    responseTime: `${responseTime}ms`,
                    propertyCount,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          const responseTime = Date.now() - startTime;
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: 'disconnected',
                    url,
                    error: error instanceof Error ? error.message : String(error),
                    responseTime: `${responseTime}ms`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      case 'get_telemetry_reference': {
        const catalog = await loadCatalog();
        const sectionFilter = toolArgs.section;
        const searchFilter = toolArgs.filter;
        const wiredOnly = toolArgs.wiredOnly === 'true';

        let sections = catalog.sections;

        // Filter by section ID
        if (sectionFilter) {
          sections = sections.filter((s) => s.id === sectionFilter);
          if (sections.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: `Section "${sectionFilter}" not found`,
                    availableSections: catalog.sections.map((s) => ({
                      id: s.id,
                      title: s.title,
                      source: s.source,
                      fieldCount: s.fields.length,
                    })),
                  }, null, 2),
                },
              ],
            };
          }
        }

        // Apply wired filter and search filter per section
        const resultSections = sections.map((section) => {
          let fields = section.fields;

          if (wiredOnly) {
            fields = fields.filter((f) => f.wired);
          }

          if (searchFilter) {
            try {
              const regex = new RegExp(searchFilter, 'i');
              fields = fields.filter(
                (f) =>
                  regex.test(f.name) ||
                  regex.test(f.desc) ||
                  regex.test(f.type) ||
                  (f.unit && regex.test(f.unit))
              );
            } catch {
              throw new Error(`Invalid regex filter: ${searchFilter}`);
            }
          }

          return {
            id: section.id,
            title: section.title,
            source: section.source,
            fieldCount: fields.length,
            fields,
          };
        }).filter((s) => s.fieldCount > 0);

        const totalFields = resultSections.reduce((sum, s) => sum + s.fieldCount, 0);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                version: catalog.version,
                totalFields,
                sectionCount: resultSections.length,
                sources: catalog.sources,
                sections: resultSections,
              }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Server error:', err);
  process.exit(1);
});
