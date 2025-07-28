import * as vscode from 'vscode';
import Ajv, { ErrorObject } from 'ajv';
import { LineCounter, parseDocument } from 'yaml';
import { openFlowSchema } from './openapi';

function removeMapping(obj: any) {
  if (obj && typeof obj === 'object') {
    if (obj.discriminator?.mapping) delete obj.discriminator.mapping;
    for (const v of Object.values(obj)) removeMapping(v);
  }
}

export class FlowValidator {
  private ajv: Ajv;
  private validate: any;

  constructor() {
    this.ajv = new Ajv({ strict: false, allErrors: true, discriminator: true });
    
    removeMapping(openFlowSchema);
    
    // Register every component schema so $refs resolve
    const { schemas } = openFlowSchema.components;
    for (const [name, schema] of Object.entries(schemas)) {
      this.ajv.addSchema(schema, `#/components/schemas/${name}`);
    }
    
    // Get the compiled validator for the root "OpenFlow" object
    this.validate = this.ajv.getSchema('#/components/schemas/OpenFlow');
    
    if (!this.validate) {
      throw new Error('Failed to compile OpenFlow schema');
    }
  }

  public validateFlow(document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    
    try {
      const yamlText = document.getText();
      
      // Parse with line counter for position mapping
      const lineCounter = new LineCounter();
      const doc = parseDocument(yamlText, { lineCounter });
      
      // Convert to JS object for validation
      const parsedYaml = doc.toJS();
      
      // Validate with AJV
      const isValid = this.validate(parsedYaml);

      console.log(this.validate.errors);
      
      if (!isValid && this.validate.errors) {
        for (const error of this.validate.errors) {
          const diagnostic = this.createDiagnosticFromError(error, doc, lineCounter, document);
          if (diagnostic) {
            diagnostics.push(diagnostic);
          }
        }
      }
    } catch (yamlError: any) {
      console.error(yamlError);
    }
    
    return diagnostics;
  }

  private createDiagnosticFromError(
    error: ErrorObject,
    doc: any,
    lineCounter: LineCounter,
    document: vscode.TextDocument
  ): vscode.Diagnostic | null {
    try {
      // Convert JSON pointer to source location
      const path = error.instancePath || '';
      const pointer = this.jsonPointerToPath(path);
      
      // Try to find the location in the YAML document
      let position: vscode.Position;
      
      if (pointer.length > 0) {
        const node = this.findNodeByPath(doc.contents, pointer);
        if (node && node.range) {
          // Convert byte offset to line/column position
          const { line, col } = lineCounter.linePos(node.range[0]);
          position = new vscode.Position(line - 1, col - 1); // VS Code uses 0-based
        } else {
          // Fallback: try to find the key in the document text
          position = this.findKeyInDocument(document, pointer);
        }
      } else {
        position = new vscode.Position(0, 0);
      }
      
      // Create a range (for now, just highlight the position)
      const range = new vscode.Range(position, position);
      
      const message = this.formatErrorMessage(error);
      
      return {
        message,
        range,
        severity: vscode.DiagnosticSeverity.Error,
        source: 'openflow-validator'
      };
    } catch (e) {
      console.error('Error creating diagnostic:', e);
      return null;
    }
  }

  private findNodeByPath(node: any, path: string[]): any {
    if (!node || path.length === 0) {
      return node;
    }
    
    const [head, ...tail] = path;
    
    if (node.type === 'MAP' && node.items) {
      for (const item of node.items) {
        if (item.key && item.key.value === head) {
          return this.findNodeByPath(item.value, tail);
        }
      }
    } else if (node.type === 'SEQ' && node.items) {
      const index = parseInt(head, 10);
      if (!isNaN(index) && index < node.items.length) {
        return this.findNodeByPath(node.items[index], tail);
      }
    }
    
    return null;
  }

  private jsonPointerToPath(pointer: string): string[] {
    if (!pointer || pointer === '/') {
      return [];
    }
    
    return pointer
      .split('/')
      .slice(1) // Remove empty first element
      .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  }

  private findKeyInDocument(document: vscode.TextDocument, path: string[]): vscode.Position {
    const text = document.getText();
    const lines = text.split('\n');
    
    if (path.length === 0) {
      return new vscode.Position(0, 0);
    }
    
    // Simple heuristic: look for the last key in the path
    const lastKey = path[path.length - 1];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const keyMatch = line.match(new RegExp(`^\\s*${lastKey}\\s*:`));
      if (keyMatch) {
        return new vscode.Position(i, keyMatch.index || 0);
      }
    }
    
    return new vscode.Position(0, 0);
  }

  private formatErrorMessage(error: ErrorObject): string {
    const path = error.instancePath || '';
    const keyword = error.keyword;
    
    switch (keyword) {
      case 'required':
        return `Missing required property: ${error.params?.missingProperty}`;
      case 'type':
        return `Expected ${error.params?.type} but got ${typeof error.data}`;
      case 'enum':
        return `Value must be one of: ${error.params?.allowedValues?.join(', ')}`;
      case 'additionalProperties':
        return `Unexpected property: ${error.params?.additionalProperty}`;
      case 'oneOf':
        return `Value does not match any of the expected types`;
      default:
        return `${error.message}${path ? ` at ${path}` : ''}`;
    }
  }
}