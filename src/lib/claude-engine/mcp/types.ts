export type McpTransportType = 'stdio' | 'sse' | 'http';

export type McpServerConfig = {
  name: string;
  type: McpTransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

export type McpServerState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected'; capabilities: McpCapabilities }
  | { status: 'error'; error: string };

export type McpCapabilities = {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type McpResource = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

export type McpToolResult = {
  content: McpContentItem[];
  isError?: boolean;
};

export type McpContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | {
      type: 'resource';
      resource: {
        uri: string;
        text?: string;
        blob?: string;
        mimeType?: string;
      };
    };

export type McpResourceContent = {
  uri: string;
  text?: string;
  blob?: string;
  mimeType?: string;
};