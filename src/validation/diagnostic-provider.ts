import * as vscode from 'vscode';
import { WindmillYamlValidator, getValidationTargetFromFilename } from "windmill-yaml-validator"
import { getLocationForJsonPath, YamlParserResult } from '@stoplight/yaml';

export class WindmillDiagnosticProvider {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private validator: WindmillYamlValidator;

  private get enabled(): boolean {
    return vscode.workspace.getConfiguration('windmill.diagnostics').get('enabled', true);
  }

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('windmill');
    this.validator = new WindmillYamlValidator();
  }

  public activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(this.diagnosticCollection);

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && this.isValidatable(activeEditor.document)) {
      this.validateDocument(activeEditor.document);
    }

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        if (this.isValidatable(event.document)) {
          this.validateDocument(event.document);
        }
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument(document => {
        if (this.isValidatable(document)) {
          this.validateDocument(document);
        }
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument(document => {
        this.diagnosticCollection.delete(document.uri);
      })
    );

    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && this.isValidatable(editor.document)) {
          this.validateDocument(editor.document);
        }
      })
    );

    // Re-validate or clear when the setting changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('windmill.diagnostics.enabled')) {
          if (this.enabled) {
            const editor = vscode.window.activeTextEditor;
            if (editor && this.isValidatable(editor.document)) {
              this.validateDocument(editor.document);
            }
          } else {
            this.diagnosticCollection.clear();
          }
        }
      })
    );
  }

  public dispose() {
    this.diagnosticCollection.dispose();
  }

  private isValidatable(document: vscode.TextDocument): boolean {
    return getValidationTargetFromFilename(document.uri.path) !== null;
  }

  private validateDocument(document: vscode.TextDocument) {
    if (!this.enabled) {
      this.diagnosticCollection.delete(document.uri);
      return;
    }

    const target = getValidationTargetFromFilename(document.uri.path);
    if (!target) {
      return;
    }

    try {
      const { parsed, errors } = this.validator.validate(document.getText(), target);
      const diagnostics: vscode.Diagnostic[] = [];
      for (const error of errors) {
        try {
          diagnostics.push(this.toDiagnostic(error, parsed));
        } catch {
          // Skip errors where we can't determine a source location
        }
      }
      this.diagnosticCollection.set(document.uri, diagnostics);
    } catch (error) {
      console.error('Error validating document:', error);
      this.diagnosticCollection.delete(document.uri);
    }
  }

  private pointerToPath(pointer: string): string[] {
    if (!pointer) return [];
    return pointer
      .split('/')
      .slice(1)
      .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  }

  private toDiagnostic(
    err: any,
    ast: YamlParserResult<unknown>,
  ): vscode.Diagnostic {
    const path = this.pointerToPath(err.instancePath);
    const loc = getLocationForJsonPath(ast, path, true);
    if (!loc) throw new Error('No location found');
    const start = new vscode.Position(loc.range.start.line, loc.range.start.character);
    const end   = new vscode.Position(loc.range.end.line,   loc.range.end.character);
    const range = new vscode.Range(start, end);

    const msg =
      err.keyword === 'enum'
        ? `Value must be one of: ${(err.params as any).allowedValues.filter((v: unknown) => v !== null).join(', ')}`
        : err.message ?? 'schema error';

    return new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Error);
  }
}
