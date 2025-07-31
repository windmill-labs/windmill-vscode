import * as vscode from 'vscode';
import Ajv, { AnySchema, ErrorObject } from 'ajv';
import { parseWithPointers, getLocationForJsonPath, YamlParserResult } from '@stoplight/yaml';

// Simple implementation of json-pointer -> path conversion, mirroring @stoplight/json.pointerToPath
function pointerToPath(pointer: string): string[] {
  if (!pointer) return [];
  return pointer
    .split('/')
    .slice(1) // remove empty first element resulting from leading '/'
    .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

// Remove discriminator mapping from the schema as it's not supported by Ajv
function removeDiscriminator(obj: any) {
  if (obj && typeof obj === 'object') {
    if (obj.discriminator?.mapping) {
      delete obj.discriminator.mapping;
    }
    for (const v of Object.values(obj)) removeDiscriminator(v);
  }
}

// Function to extract $ref references from a schema
function extractRefs(schema: any): string[] {
  const refs: string[] = [];
  
  function traverse(obj: any) {
    if (obj && typeof obj === 'object') {
      if (obj.$ref && typeof obj.$ref === 'string') {
        refs.push(obj.$ref);
      }
      for (const value of Object.values(obj)) {
        traverse(value);
      }
    }
  }
  
  traverse(schema);
  return refs;
}

// Recursive function to add schema and its dependencies
const addSchemaRecursively = (ajv: Ajv, schema: any, addedSchemas: Set<string>, schemaName: string) => {
  if (addedSchemas.has(schemaName)) return;
  
  const originalSchema = schema.components.schemas[schemaName as keyof typeof schema.components.schemas];
  if (!originalSchema) return;
  
  addedSchemas.add(schemaName);
  
  // Create a deep copy to avoid modifying the original schema
  const schemaCopy = { ...originalSchema };
  
  // Remove discriminator mappings from this specific schema, as it's not supported by Ajv
  removeDiscriminator(schemaCopy);
  
  console.log("Adding schema:", schemaName, JSON.stringify(schemaCopy, null, 2));
  ajv.addSchema(schemaCopy as AnySchema, `#/components/schemas/${schemaName}`);
  
  // Extract refs from the original schema (before modification)
  const refs = extractRefs(originalSchema);
  for (const ref of refs) {
    // Extract schema name from ref like "#/components/schemas/SchemeName"
    const match = ref.match(/^#\/components\/schemas\/(.+)$/);
    if (match) {
      addSchemaRecursively(ajv, schema, addedSchemas, match[1]);
    }
  }
};

export class FlowValidator {
  private validate: ReturnType<Ajv['compile']>;
  private ajv = new Ajv({ strict: false, allErrors: true, discriminator: true });

  constructor(schema: any) {
    const addedSchemas = new Set<string>();
    // fix disparency between what api gives and what is expected
    const stringified = JSON.stringify(schema)
    .replace(/schemas-InputTransform/g, "InputTransform")
    .replace(/("WhileloopFlow"[\s\S]*?"enum":\s*\[)"forloopflow"/, '$1"whileloopflow"')
    .replace(/("StaticTransform"[\s\S]*?"enum":\s*\[)"javascript"/, '$1"static"')
    .replace(/("StaticTransform"[\s\S]*?"required":\s*\[)"expr"/, '$1"value"');
    const toUse = JSON.parse(stringified);
    addSchemaRecursively(this.ajv, toUse, addedSchemas, 'OpenFlow');
    this.validate = this.ajv.getSchema('#/components/schemas/OpenFlow')!;
  }

  public validateFlow(doc: vscode.TextDocument): vscode.Diagnostic[] {
    const parsed = parseWithPointers(doc.getText());
    const { data } = parsed;

    const ok = this.validate(data);
    if (ok || !this.validate.errors) return [];

    return this.validate.errors
      .filter(e => e.keyword !== 'oneOf')          // optional: drop summary row
      .map(err => this.toDiagnostic(err, parsed));
  }

  private toDiagnostic(
    err: ErrorObject,
    ast: YamlParserResult<unknown>,
  ): vscode.Diagnostic {
    const path = pointerToPath(err.instancePath);
    const loc = getLocationForJsonPath(ast, path, true); // 'closest' never returns null
    if (!loc) throw new Error('No location found');
    const start = new vscode.Position(loc.range.start.line, loc.range.start.character);
    const end   = new vscode.Position(loc.range.end.line,   loc.range.end.character);
    const range = new vscode.Range(start, end);

    const msg =
      err.keyword === 'enum'
        ? `Value must be one of: ${(err.params as any).allowedValues.join(', ')}`
        : err.message ?? 'schema error';

    return new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Error);
  }
}