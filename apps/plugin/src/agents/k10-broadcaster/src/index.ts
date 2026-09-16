import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  TextContent,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { readdir, readFile } from 'fs/promises';

// Resolve the K10 broadcaster root path
const K10_ROOT = process.env.K10_BROADCASTER_ROOT ||
  path.resolve(__dirname, '../../../..', 'racecor-overlay');

interface ComponentInfo {
  name: string;
  filePath: string;
  category: string;
  hasCss: boolean;
}

interface TestInfo {
  name: string;
  filePath: string;
}

interface SearchResult {
  filePath: string;
  lineNumber: number;
  line: string;
  context: string[];
}

/**
 * Recursively find all component files and categorize them
 */
async function findComponents(baseDir: string): Promise<ComponentInfo[]> {
  const components: ComponentInfo[] = [];
  const componentsDir = path.join(baseDir, 'components');

  if (!fs.existsSync(componentsDir)) {
    return components;
  }

  async function walkDir(dir: string, category: string = ''): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Use directory name as category if not already set
        const newCategory = !category ? entry.name : category;
        await walkDir(fullPath, newCategory);
      } else if (entry.name.endsWith('.tsx')) {
        const componentName = entry.name.replace('.tsx', '');
        const cssPath = fullPath.replace('.tsx', '.module.css');
        const hasCss = fs.existsSync(cssPath);

        components.push({
          name: componentName,
          filePath: fullPath,
          category: category || 'root',
          hasCss,
        });
      }
    }
  }

  await walkDir(componentsDir);
  return components.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Find all test files
 */
async function findTests(baseDir: string): Promise<TestInfo[]> {
  const tests: TestInfo[] = [];
  const testDir = path.join(baseDir, 'test');

  if (!fs.existsSync(testDir)) {
    return tests;
  }

  async function walkDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walkDir(fullPath);
      } else if (entry.name.endsWith('.test.tsx') || entry.name.endsWith('.test.ts')) {
        const testName = entry.name.replace('.test.tsx', '').replace('.test.ts', '');
        tests.push({
          name: testName,
          filePath: fullPath,
        });
      }
    }
  }

  await walkDir(testDir);
  return tests.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Search files for a pattern
 */
async function searchFiles(
  dir: string,
  pattern: RegExp,
  fileType: string
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const extensions = {
    tsx: '.tsx',
    ts: '.ts',
    css: '.css',
    all: '',
  };

  const ext = (extensions as Record<string, string>)[fileType] || '';

  async function walkDir(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) return;

    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules
        if (entry.name !== 'node_modules') {
          await walkDir(fullPath);
        }
      } else if (!ext || entry.name.endsWith(ext)) {
        try {
          const content = await readFile(fullPath, 'utf-8');
          const lines = content.split('\n');

          lines.forEach((line, index) => {
            if (pattern.test(line)) {
              const contextStart = Math.max(0, index - 1);
              const contextEnd = Math.min(lines.length, index + 2);
              const context = lines.slice(contextStart, contextEnd);

              results.push({
                filePath: fullPath,
                lineNumber: index + 1,
                line: line.trim(),
                context: context.map((l) => l.trim()),
              });
            }
          });
        } catch (err) {
          // Skip files that can't be read
        }
      }
    }
  }

  await walkDir(dir);
  return results;
}

/**
 * Parse Dashboard.tsx to extract component tree
 */
async function getComponentTree(): Promise<string> {
  const dashboardPath = path.join(K10_ROOT, 'components/layout/Dashboard.tsx');

  try {
    const content = await readFile(dashboardPath, 'utf-8');

    // Extract imports
    const importMatches = content.match(/import.*?from ['"].*?['"];?/g) || [];
    const imports = importMatches.map((im) => im.trim()).join('\n');

    // Extract the JSX structure (simplified)
    const jsxStart = content.indexOf('return (');
    const jsxEnd = content.lastIndexOf(')');
    const jsxSection = jsxStart !== -1 ? content.slice(jsxStart + 8, jsxEnd) : '';

    return `# Component Tree (Dashboard.tsx)\n\n## Imports\n\`\`\`typescript\n${imports}\n\`\`\`\n\n## JSX Structure\n\`\`\`jsx\n${jsxSection.trim()}\n\`\`\``;
  } catch (err) {
    return `# Component Tree Error\n\nCould not read Dashboard.tsx: ${err}`;
  }
}

const server = new Server(
  {
    name: 'k10-broadcaster',
    version: '1.0.0',
  },
  {
    capabilities: { tools: {} },
  }
);

/**
 * List all tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_components',
      description:
        'Lists all React components with their file paths and CSS module status',
      inputSchema: {
        type: 'object' as const,
        properties: {
          category: {
            type: 'string',
            description:
              'Filter by category: "hud", "panels", "overlays", "settings", "layout", or "all" (default: all)',
          },
        },
      },
    },
    {
      name: 'get_component',
      description: 'Reads a component TSX file and its CSS module (if exists)',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string',
            description:
              'Component name without extension (e.g., "Tachometer", "FuelPanel", "Dashboard")',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'get_telemetry_types',
      description: 'Reads src/types/telemetry.ts with all telemetry type definitions',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'get_settings_types',
      description: 'Reads src/types/settings.ts with all overlay settings definitions',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'get_hook',
      description: 'Reads a hook file from src/hooks',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string',
            description: 'Hook name: "useTelemetry" or "useSettings"',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'get_lib',
      description: 'Reads a library file from src/lib',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string',
            description: '"formatters", "manufacturers", or "telemetry-client"',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'list_tests',
      description: 'Lists all test files with file paths',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'get_test',
      description: 'Reads a specific test file',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string',
            description: 'Test name without extension (e.g., "formatters", "components/Tachometer")',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'get_build_config',
      description: 'Reads vite.config.ts, tsconfig.json, and package.json',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'get_design_tokens',
      description: 'Reads src/styles/tokens.css with CSS custom properties',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'get_component_tree',
      description:
        'Returns the full component hierarchy from Dashboard.tsx with imports and JSX structure',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'search_source',
      description: 'Searches across React source for a pattern with line context',
      inputSchema: {
        type: 'object' as const,
        properties: {
          pattern: {
            type: 'string',
            description: 'Regex pattern to search for',
          },
          fileType: {
            type: 'string',
            description: '"tsx", "ts", "css", or "all" (default: all)',
          },
        },
        required: ['pattern'],
      },
    },
  ],
}));

/**
 * Handle tool calls
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_components': {
        const category = (args as Record<string, unknown>).category as string | undefined;
        let components = await findComponents(K10_ROOT);

        if (category && category !== 'all') {
          components = components.filter((c) => c.category === category);
        }

        const summary = components
          .map((c) => `${c.name} (${c.category}) - ${c.hasCss ? 'has CSS' : 'no CSS'}`)
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Found ${components.length} components:\n\n${summary}`,
            },
          ],
        };
      }

      case 'get_component': {
        const componentName = (args as Record<string, unknown>).name as string;
        const components = await findComponents(K10_ROOT);
        const comp = components.find((c) => c.name === componentName);

        if (!comp) {
          return {
            content: [{ type: 'text' as const, text: `Component "${componentName}" not found` }],
          };
        }

        const tsxContent = await readFile(comp.filePath, 'utf-8');
        let cssContent = '';

        if (comp.hasCss) {
          const cssPath = comp.filePath.replace('.tsx', '.module.css');
          cssContent = await readFile(cssPath, 'utf-8');
        }

        const combined = comp.hasCss
          ? `# ${componentName}.tsx\n\n\`\`\`tsx\n${tsxContent}\n\`\`\`\n\n# ${componentName}.module.css\n\n\`\`\`css\n${cssContent}\n\`\`\``
          : `# ${componentName}.tsx\n\n\`\`\`tsx\n${tsxContent}\n\`\`\``;

        return {
          content: [{ type: 'text' as const, text: combined }],
        };
      }

      case 'get_telemetry_types': {
        const filePath = path.join(K10_ROOT, 'types/telemetry.ts');
        const content = await readFile(filePath, 'utf-8');
        return {
          content: [
            {
              type: 'text' as const,
              text: `# Telemetry Types\n\n\`\`\`typescript\n${content}\n\`\`\``,
            },
          ],
        };
      }

      case 'get_settings_types': {
        const filePath = path.join(K10_ROOT, 'types/settings.ts');
        const content = await readFile(filePath, 'utf-8');
        return {
          content: [
            {
              type: 'text' as const,
              text: `# Settings Types\n\n\`\`\`typescript\n${content}\n\`\`\``,
            },
          ],
        };
      }

      case 'get_hook': {
        const hookName = (args as Record<string, unknown>).name as string;
        const fileName = hookName.includes('Telemetry')
          ? 'useTelemetry.tsx'
          : hookName.includes('Settings')
          ? 'useSettings.tsx'
          : `${hookName}.tsx`;

        const filePath = path.join(K10_ROOT, 'hooks', fileName);

        if (!fs.existsSync(filePath)) {
          return {
            content: [{ type: 'text' as const, text: `Hook "${hookName}" not found` }],
          };
        }

        const content = await readFile(filePath, 'utf-8');
        return {
          content: [
            {
              type: 'text' as const,
              text: `# ${hookName}\n\n\`\`\`typescript\n${content}\n\`\`\``,
            },
          ],
        };
      }

      case 'get_lib': {
        const libName = (args as Record<string, unknown>).name as string;
        const fileName =
          libName === 'formatters'
            ? 'formatters.ts'
            : libName === 'manufacturers'
            ? 'manufacturers.ts'
            : libName === 'telemetry-client'
            ? 'telemetry-client.ts'
            : `${libName}.ts`;

        const filePath = path.join(K10_ROOT, 'lib', fileName);

        if (!fs.existsSync(filePath)) {
          return {
            content: [{ type: 'text' as const, text: `Library "${libName}" not found` }],
          };
        }

        const content = await readFile(filePath, 'utf-8');
        return {
          content: [
            {
              type: 'text' as const,
              text: `# ${libName}\n\n\`\`\`typescript\n${content}\n\`\`\``,
            },
          ],
        };
      }

      case 'list_tests': {
        const tests = await findTests(K10_ROOT);
        const summary = tests.map((t) => `${t.name}`).join('\n');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Found ${tests.length} test files:\n\n${summary}`,
            },
          ],
        };
      }

      case 'get_test': {
        const testName = (args as Record<string, unknown>).name as string;
        const tests = await findTests(K10_ROOT);
        const test = tests.find((t) => t.name === testName);

        if (!test) {
          return {
            content: [{ type: 'text' as const, text: `Test "${testName}" not found` }],
          };
        }

        const content = await readFile(test.filePath, 'utf-8');
        return {
          content: [
            {
              type: 'text' as const,
              text: `# ${testName} Test\n\n\`\`\`typescript\n${content}\n\`\`\``,
            },
          ],
        };
      }

      case 'get_build_config': {
        const viteConfigPath = path.join(
          K10_ROOT,
          '..',
          'vite.config.ts'
        );
        const tsconfigPath = path.join(K10_ROOT, '..', 'tsconfig.json');
        const packagePath = path.join(K10_ROOT, '..', 'package.json');

        let viteContent = 'File not found';
        let tsconfigContent = 'File not found';
        let packageContent = 'File not found';

        if (fs.existsSync(viteConfigPath)) {
          viteContent = await readFile(viteConfigPath, 'utf-8');
        }
        if (fs.existsSync(tsconfigPath)) {
          tsconfigContent = await readFile(tsconfigPath, 'utf-8');
        }
        if (fs.existsSync(packagePath)) {
          packageContent = await readFile(packagePath, 'utf-8');
        }

        const combined = `# vite.config.ts\n\n\`\`\`typescript\n${viteContent}\n\`\`\`\n\n# tsconfig.json\n\n\`\`\`json\n${tsconfigContent}\n\`\`\`\n\n# package.json\n\n\`\`\`json\n${packageContent}\n\`\`\``;

        return {
          content: [{ type: 'text' as const, text: combined }],
        };
      }

      case 'get_design_tokens': {
        const filePath = path.join(K10_ROOT, 'styles/tokens.css');

        if (!fs.existsSync(filePath)) {
          return {
            content: [{ type: 'text' as const, text: 'Design tokens file not found' }],
          };
        }

        const content = await readFile(filePath, 'utf-8');
        return {
          content: [
            {
              type: 'text' as const,
              text: `# Design Tokens (tokens.css)\n\n\`\`\`css\n${content}\n\`\`\``,
            },
          ],
        };
      }

      case 'get_component_tree': {
        const tree = await getComponentTree();
        return {
          content: [{ type: 'text' as const, text: tree }],
        };
      }

      case 'search_source': {
        const patternStr = (args as Record<string, unknown>).pattern as string;
        const fileType = ((args as Record<string, unknown>).fileType as string) || 'all';

        try {
          const pattern = new RegExp(patternStr, 'i');
          const results = await searchFiles(K10_ROOT, pattern, fileType);

          if (results.length === 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `No matches found for pattern: "${patternStr}"`,
                },
              ],
            };
          }

          const summary = results
            .slice(0, 50) // Limit to first 50 results
            .map(
              (r) =>
                `${path.relative(K10_ROOT, r.filePath)}:${r.lineNumber}\n  ${r.line}\n  Context: ${r.context.join(' | ')}`
            )
            .join('\n\n');

          const totalText =
            results.length > 50
              ? `\n\n... and ${results.length - 50} more matches (showing first 50)`
              : '';

          return {
            content: [
              {
                type: 'text' as const,
                text: `Found ${results.length} matches for "${patternStr}":\n\n${summary}${totalText}`,
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Invalid regex pattern: ${err}`,
              },
            ],
          };
        }
      }

      default:
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
});

/**
 * Start the server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
