// Hubwork tool definitions for Gemini Function Calling (browser-safe)

import type { ToolDefinition } from "~/types/settings";

export const HUBWORK_TOOL_NAME = "get_spreadsheet_schema";

export const GMAIL_SEND_TOOL_NAME = "gmail_send_email";

export const HUBWORK_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: HUBWORK_TOOL_NAME,
    description:
      "Get the schema (sheet tab names and column headers) of a configured Google Spreadsheet. " +
      "Use this to understand the data structure before building workflows that read/write sheets, " +
      "or before configuring authentication account types. " +
      "If spreadsheetId is omitted, returns schema for the first configured spreadsheet.",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The Google Spreadsheet ID. Optional — defaults to the first configured spreadsheet.",
        },
      },
    },
  },
];

export const MIGRATE_TOOL_NAME = "migrate_spreadsheet_schema";

export const HUBWORK_TOOL_DEFINITIONS_EXTRA: ToolDefinition[] = [
  {
    name: MIGRATE_TOOL_NAME,
    description:
      "Apply a schema definition to the spreadsheet — creates missing sheets and appends missing columns. " +
      "Pass the full content of web/__gemihub/schema.md as the schema parameter. " +
      "Read the file with read_drive_file first, then call this tool with the content.",
    parameters: {
      type: "object",
      properties: {
        schema: {
          type: "string",
          description: "The full content of schema.md (markdown with ## sheet_name and - column_name format).",
        },
      },
      required: ["schema"],
    },
  },
];

export const CALENDAR_TOOL_NAMES = new Set([
  "calendar_list_events",
  "calendar_create_event",
  "calendar_update_event",
  "calendar_delete_event",
]);
