import * as vscode from 'vscode';
import { FlowValidator } from './flow-validator';

export class FlowDiagnosticProvider {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private validator: FlowValidator | null;

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('openflow');
    try {
      this.validator = new FlowValidator();
    } catch (error) {
      console.error('Failed to initialize FlowValidator:', error);
      this.validator = null;
    }
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

  private isFlowYamlFile(document: vscode.TextDocument): boolean {
    return document.uri.path.endsWith('.flow.yaml') || document.uri.path.endsWith('flow.yaml');
  }

  private validateDocument(document: vscode.TextDocument) {
    if (!this.validator) {
      // If validator failed to initialize, skip validation
      return;
    }
    
    try {
      const diagnostics = this.validator.validateFlow(document);
      this.diagnosticCollection.set(document.uri, diagnostics);
    } catch (error) {
      console.error('Error validating flow document:', error);
      // Clear diagnostics on error to avoid stale diagnostics
      this.diagnosticCollection.delete(document.uri);
    }
  }

  public dispose() {
    this.diagnosticCollection.dispose();
  }
}