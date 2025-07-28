import * as vscode from 'vscode';
import Ajv, { ErrorObject } from 'ajv';
import { parseWithPointers, getLocationForJsonPath, YamlParserResult } from '@stoplight/yaml';
import { openFlowSchema } from './openapi';

// Simple implementation of json-pointer -> path conversion, mirroring @stoplight/json.pointerToPath
function pointerToPath(pointer: string): string[] {
  if (!pointer) return [];
  return pointer
    .split('/')
    .slice(1) // remove empty first element resulting from leading '/'
    .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export class FlowValidator {
  private validate: ReturnType<Ajv['compile']>;
  private ajv = new Ajv({ strict: false, allErrors: true, discriminator: true });

  constructor() {
    function removeMapping(obj: any) {
      if (obj && typeof obj === 'object') {
        if (obj.discriminator?.mapping) delete obj.discriminator.mapping;
        for (const v of Object.values(obj)) removeMapping(v);
      }
    }
    removeMapping(openFlowSchema);

    for (const [n, s] of Object.entries(openFlowSchema.components.schemas))
      this.ajv.addSchema(s, `#/components/schemas/${n}`);

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