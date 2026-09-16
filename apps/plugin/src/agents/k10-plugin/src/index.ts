import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFile, readdir } from 'fs/promises';
import { join, relative } from 'path';

// Resolve base paths
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = process.env.K10_PLUGIN_ROOT || join(__dirname, '../../../..', 'racecor-plugin');
const PLUGIN_SOURCE_DIR = join(PLUGIN_ROOT, 'plugin/RaceCorProDrive.Plugin');
const DATASET_DIR = join(PLUGIN_ROOT, 'dataset');

interface CommentaryTopic {
  id: string;
  category: string;
  title: string;
  sentiment: string;
  severity: number;
  eventExposition: string;
  triggers: Array<{
    dataPoint: string;
    condition: string;
    [key: string]: unknown;
  }>;
  cooldownMinutes: number;
  [key: string]: unknown;
}

interface CommentaryTopicsData {
  version: string;
  description: string;
  categories: string[];
  topics: CommentaryTopic[];
}

interface TelemetryProperty {
  name: string;
  type: string;
  docComment?: string;
}

interface HttpProperty {
  name: string;
  value?: string;
}

// Helper: Parse C# properties from file content
async function parseTelemetryProperties(): Promise<TelemetryProperty[]> {
  const filePath = join(PLUGIN_SOURCE_DIR, 'Engine', 'TelemetrySnapshot.cs');
  const content = await readFile(filePath, 'utf-8');

  const properties: TelemetryProperty[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: public <type> <name> { get; set; }
    const match = line.match(/public\s+(\S+(?:\s*\[\])?)\s+(\w+)\s*{?\s*get;\s*set;/);
    if (match) {
      const type = match[1];
      const name = match[2];
      properties.push({ name, type });
    }
  }

  return properties;
}

// Helper: Parse HTTP JSON property keys from Plugin.cs
async function parseHttpProperties(): Promise<HttpProperty[]> {
  const filePath = join(PLUGIN_SOURCE_DIR, 'Plugin.cs');
  const content = await readFile(filePath, 'utf-8');

  const properties: HttpProperty[] = [];
  // Match: Jp(sb, "propertyName", ...
  const regex = /Jp\(sb,\s*"([^"]+)"/g;
  let match;

  const seen = new Set<string>();
  while ((match = regex.exec(content)) !== null) {
    const propName = match[1];
    if (!seen.has(propName)) {
      properties.push({ name: propName });
      seen.add(propName);
    }
  }

  return properties.sort((a, b) => a.name.localeCompare(b.name));
}

// Helper: List C# source files
async function listSourceFiles(): Promise<string[]> {
  const files: string[] = [];

  async function walkDir(dir: string, prefix = ''): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Skip obj and bin directories
          if (entry.name !== 'obj' && entry.name !== 'bin') {
            await walkDir(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
          }
        } else if (entry.name.endsWith('.cs')) {
          const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
          files.push(relPath);
        }
      }
    } catch (error) {
      // Directory read error, skip
    }
  }

  await walkDir(PLUGIN_SOURCE_DIR);
  return files.sort();
}

// Helper: Load commentary topics
async function loadCommentaryTopics(): Promise<CommentaryTopicsData> {
  const filePath = join(DATASET_DIR, 'commentary_topics.json');
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as CommentaryTopicsData;
}

// Tool implementations
async function listCommentaryTopics(filter?: string): Promise<object> {
  const data = await loadCommentaryTopics();
  let topics = data.topics;

  if (filter) {
    try {
      const regex = new RegExp(filter, 'i');
      topics = topics.filter(t => regex.test(t.id) || regex.test(t.category) || regex.test(t.title));
    } catch {
      return { error: `Invalid filter regex: ${filter}` };
    }
  }

  return {
    version: data.version,
    total: data.topics.length,
    filtered: topics.length,
    categories: data.categories,
    topics: topics.map(t => ({
      id: t.id,
      category: t.category,
      title: t.title,
      sentiment: t.sentiment,
      severity: t.severity,
      cooldownMinutes: t.cooldownMinutes,
      triggerCount: t.triggers.length,
      triggers: t.triggers.map(tr => ({
        dataPoint: tr.dataPoint,
        condition: tr.condition,
      })),
    })),
  };
}

async function getCommentaryTopic(topicId: string): Promise<object> {
  const data = await loadCommentaryTopics();
  const topic = data.topics.find(t => t.id === topicId);

  if (!topic) {
    return { error: `Topic not found: ${topicId}` };
  }

  return topic;
}

async function listTriggerConditions(): Promise<object> {
  const data = await loadCommentaryTopics();
  const conditions = new Set<string>();
  const examples: { [key: string]: string[] } = {};

  for (const topic of data.topics) {
    for (const trigger of topic.triggers) {
      const condition = trigger.condition as string;
      conditions.add(condition);

      if (!examples[condition]) {
        examples[condition] = [];
      }
      if (examples[condition].length < 3) {
        examples[condition].push(`${topic.id}/${trigger.dataPoint}`);
      }
    }
  }

  return {
    conditions: Array.from(conditions).sort(),
    examples,
    count: conditions.size,
  };
}

async function getTelemetrySchema(): Promise<object> {
  const properties = await parseTelemetryProperties();
  return {
    count: properties.length,
    properties: properties.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function getPluginSource(filename: string): Promise<object> {
  // Sanitize filename to prevent directory traversal
  if (filename.includes('..') || filename.startsWith('/')) {
    return { error: 'Invalid filename' };
  }

  const filePath = join(PLUGIN_SOURCE_DIR, filename);
  try {
    const content = await readFile(filePath, 'utf-8');
    return {
      filename,
      path: filePath,
      lines: content.split('\n').length,
      content,
    };
  } catch (error) {
    return { error: `Failed to read file: ${filename}` };
  }
}

async function listPluginFiles(): Promise<object> {
  const files = await listSourceFiles();
  return {
    count: files.length,
    pluginRoot: PLUGIN_SOURCE_DIR,
    files,
  };
}

async function getDatasetFile(filename: string): Promise<object> {
  // Sanitize filename
  if (filename.includes('..') || filename.startsWith('/')) {
    return { error: 'Invalid filename' };
  }

  if (!filename.endsWith('.json')) {
    return { error: 'Only JSON files are supported' };
  }

  const filePath = join(DATASET_DIR, filename);
  try {
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return {
      filename,
      path: filePath,
      data,
    };
  } catch (error) {
    return { error: `Failed to read dataset file: ${filename}` };
  }
}

async function listHttpProperties(): Promise<object> {
  const properties = await parseHttpProperties();
  return {
    count: properties.length,
    properties: properties.map(p => p.name),
  };
}

// Tool handler
async function handleToolCall(toolName: string, toolInput: Record<string, unknown>): Promise<string> {
  try {
    let result: object;

    switch (toolName) {
      case 'list_commentary_topics':
        result = await listCommentaryTopics(toolInput.filter as string | undefined);
        break;

      case 'get_commentary_topic':
        result = await getCommentaryTopic(toolInput.topicId as string);
        break;

      case 'list_trigger_conditions':
        result = await listTriggerConditions();
        break;

      case 'get_telemetry_schema':
        result = await getTelemetrySchema();
        break;

      case 'get_plugin_source':
        result = await getPluginSource(toolInput.filename as string);
        break;

      case 'list_plugin_files':
        result = await listPluginFiles();
        break;

      case 'get_dataset_file':
        result = await getDatasetFile(toolInput.filename as string);
        break;

      case 'list_http_properties':
        result = await listHttpProperties();
        break;

      default:
        result = { error: `Unknown tool: ${toolName}` };
    }

    return JSON.stringify(result, null, 2);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Initialize and run server
const server = new Server(
  {
    name: 'k10-plugin-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_commentary_topics',
        description:
          'Lists all commentary topics from the dataset, with optional filtering by regex pattern',
        inputSchema: {
          type: 'object' as const,
          properties: {
            filter: {
              type: 'string',
              description:
                'Optional regex pattern to filter by topic ID, category, or title',
            },
          },
        },
      },
      {
        name: 'get_commentary_topic',
        description: 'Gets the complete definition of a single commentary topic',
        inputSchema: {
          type: 'object' as const,
          properties: {
            topicId: {
              type: 'string',
              description: 'The ID of the topic to retrieve',
            },
          },
          required: ['topicId'],
        },
      },
      {
        name: 'list_trigger_conditions',
        description:
          'Lists all unique trigger condition types used across commentary topics with examples',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
      },
      {
        name: 'get_telemetry_schema',
        description:
          'Reads TelemetrySnapshot.cs and returns the list of all telemetry properties',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
      },
      {
        name: 'get_plugin_source',
        description: 'Reads a specific plugin source file (*.cs)',
        inputSchema: {
          type: 'object' as const,
          properties: {
            filename: {
              type: 'string',
              description:
                'Path to the file relative to plugin root, e.g. "Plugin.cs" or "Engine/TriggerEvaluator.cs"',
            },
          },
          required: ['filename'],
        },
      },
      {
        name: 'list_plugin_files',
        description: 'Lists all .cs files in the plugin source directory',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
      },
      {
        name: 'get_dataset_file',
        description: 'Reads a dataset JSON file and returns parsed JSON',
        inputSchema: {
          type: 'object' as const,
          properties: {
            filename: {
              type: 'string',
              description:
                'Name of the dataset file, e.g. "sentiments.json" or "commentary_fragments.json"',
            },
          },
          required: ['filename'],
        },
      },
      {
        name: 'list_http_properties',
        description:
          'Extracts all HTTP JSON property keys exposed by the plugin (parsed from Plugin.cs)',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params;
  const toolInput = (args || {}) as Record<string, unknown>;
  const result = await handleToolCall(name, toolInput);
  return {
    content: [{ type: 'text' as const, text: result }],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
