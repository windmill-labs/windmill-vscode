import * as vscode from 'vscode';
import { validateFlow } from "windmill-utils-internal"
import { ErrorObject } from 'ajv';
import { getLocationForJsonPath, YamlParserResult } from '@stoplight/yaml';

export class FlowDiagnosticProvider {
  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('openflow');
  }

  public activate(context: vscode.ExtensionContext) {
    // Register diagnostic provider
    context.subscriptions.push(this.diagnosticCollection);

    // Validate on document open
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && this.isFlowYamlFile(activeEditor.document)) {
      this.validateDocument(activeEditor.document);
    }

    // Validate on document change
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        if (this.isFlowYamlFile(event.document)) {
          this.validateDocument(event.document);
        }
      })
    );

    // Validate on document open
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument(document => {
        if (this.isFlowYamlFile(document)) {
          this.validateDocument(document);
        }
      })
    );

    // Clear diagnostics on document close
    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument(document => {
        if (this.isFlowYamlFile(document)) {
          this.diagnosticCollection.delete(document.uri);
        }
      })
    );

    // Validate on active editor change
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && this.isFlowYamlFile(editor.document)) {
          this.validateDocument(editor.document);
        }
      })
    );
  }

  public dispose() {
    this.diagnosticCollection.dispose();
  }

  private isFlowYamlFile(document: vscode.TextDocument): boolean {
    return document.uri.path.endsWith('.flow.yaml') || document.uri.path.endsWith('flow.yaml');
  }

  private validateDocument(document: vscode.TextDocument) {    
    try {
      const { parsed, errors } = validateFlow(document.getText());
      const diagnostics = errors.map(error => this.toDiagnostic(error, parsed));
      this.diagnosticCollection.set(document.uri, diagnostics);
    } catch (error) {
      console.error('Error validating flow document:', error);
      this.diagnosticCollection.delete(document.uri);
    }
  }

  // Simple implementation of json-pointer -> path conversion, mirroring @stoplight/json.pointerToPath
private pointerToPath(pointer: string): string[] {
  if (!pointer) return [];
  return pointer
    .split('/')
    .slice(1) // remove empty first element resulting from leading '/'
    .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

  private toDiagnostic(
    err: ErrorObject,
    ast: YamlParserResult<unknown>,
  ): vscode.Diagnostic {
    const path = this.pointerToPath(err.instancePath);
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
