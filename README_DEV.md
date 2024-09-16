## Development

Inside the editor, open src/extension.ts and press F5. This will compile and run the extension in a new Extension Development Host window.

To run unit tests run: `npm test`

## Quickstart

1. `npm install`
2. `npm install -g vsce`
3. `vsce package`
4. `code --install-extension ./windmill-<version>.vsix` or `cursor --install-extension ./windmill-<version>.vsix`

It is worth noting that sed works differently on Mac and Linux/Windows. The scripts below may need to be adjusted if you are on Mac.

```
{
    "scripts": {
       "switch-node": "sed -i '' 's/import { testBundle } from \".\\/esbuild.web\";/import { testBundle } from \".\\/esbuild\";/g' src/extension.ts",
       "switch-web": "sed -i '' 's/import { testBundle } from \".\\/esbuild\";/import { testBundle } from \".\\/esbuild.web\";/g' src/extension.ts",
    }
}
```
