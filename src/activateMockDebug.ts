/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
/*
 * activateTypeScriptDebug.ts contains the shared extension code that can be executed both in node.js and the browser.
 */

'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import { MockDebugSession } from './mockDebug';
import { FileAccessor } from './mockRuntime';

export function activateTypeScriptDebug(context: vscode.ExtensionContext, factory?: vscode.DebugAdapterDescriptorFactory) {

	context.subscriptions.push(
		vscode.commands.registerCommand('extension.typescript-debug.runEditorContents', (resource: vscode.Uri) => {
			let targetResource = resource;
			if (!targetResource && vscode.window.activeTextEditor) {
				targetResource = vscode.window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				vscode.debug.startDebugging(undefined, {
					type: 'typescript',
					name: 'Run File',
					request: 'launch',
					program: targetResource.fsPath,
					sourceMaps: true,
					outDir: '${workspaceFolder}/dist',
					skipFiles: ['<node_internals>/**']
				},
					{ noDebug: true }
				);
			}
		}),
		vscode.commands.registerCommand('extension.typescript-debug.debugEditorContents', (resource: vscode.Uri) => {
			let targetResource = resource;
			if (!targetResource && vscode.window.activeTextEditor) {
				targetResource = vscode.window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				vscode.debug.startDebugging(undefined, {
					type: 'typescript',
					name: 'Debug File',
					request: 'launch',
					program: targetResource.fsPath,
					stopOnEntry: true,
					sourceMaps: true,
					outDir: '${workspaceFolder}/dist',
					skipFiles: ['<node_internals>/**']
				});
			}
		}),
		vscode.commands.registerCommand('extension.typescript-debug.toggleFormatting', (variable) => {
			const ds = vscode.debug.activeDebugSession;
			if (ds) {
				ds.customRequest('toggleFormatting');
			}
		}),
		vscode.commands.registerCommand('extension.typescript-debug.toggleSourceMaps', () => {
			const ds = vscode.debug.activeDebugSession;
			if (ds) {
				ds.customRequest('toggleSourceMaps');
			}
		})
	);

	context.subscriptions.push(vscode.commands.registerCommand('extension.typescript-debug.getProgramName', config => {
		return vscode.window.showInputBox({
			placeHolder: "Please enter the name of a TypeScript file in the workspace folder",
			value: "index.ts",
			validateInput: (value: string) => {
				if (!value.endsWith('.ts') && !value.endsWith('.tsx')) {
					return 'Please enter a valid TypeScript file (.ts or .tsx)';
				}
				return null;
			}
		});
	}));

	// register a configuration provider for 'typescript' debug type
	const provider = new TypeScriptConfigurationProvider();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('typescript', provider));

	// register a dynamic configuration provider for 'typescript' debug type
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('typescript', {
		provideDebugConfigurations(folder: WorkspaceFolder | undefined): ProviderResult<DebugConfiguration[]> {
			return [
				{
					name: "Dynamic TypeScript Launch",
					request: "launch",
					type: "typescript",
					program: "${file}",
					sourceMaps: true,
					outDir: "${workspaceFolder}/dist",
					skipFiles: ['<node_internals>/**']
				},
				{
					name: "Another Dynamic TypeScript Launch",
					request: "launch",
					type: "typescript",
					program: "${file}",
					sourceMaps: true,
					outDir: "${workspaceFolder}/dist",
					skipFiles: ['<node_internals>/**']
				},
				{
					name: "TypeScript Debug Launch",
					request: "launch",
					type: "typescript",
					program: "${file}",
					sourceMaps: true,
					outDir: "${workspaceFolder}/dist",
					skipFiles: ['<node_internals>/**'],
					stopOnEntry: true
				}
			];
		}
	}, vscode.DebugConfigurationProviderTriggerKind.Dynamic));

	// Option 2: More robust interface checking (alternative)

	if (!factory) {
    	factory = new InlineDebugAdapterFactory();
	}
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('typescript', factory));

// Check if factory implements Disposable interface
	function isDisposable(obj: any): obj is vscode.Disposable {
    	return obj && typeof obj.dispose === 'function';
	}

	if (isDisposable(factory)) {
    	context.subscriptions.push(factory);
	}


	// override VS Code's default implementation of the debug hover
	// here we match TypeScript variables, properties, and method calls
	context.subscriptions.push(vscode.languages.registerEvaluatableExpressionProvider('typescript', {
		provideEvaluatableExpression(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.EvaluatableExpression> {

			// Match TypeScript variables, object properties, method calls, and complex expressions
			const VARIABLE_REGEXP = /[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z_$][a-zA-Z0-9_$]*)*(\([^)]*\))?/g;
			const line = document.lineAt(position.line).text;

			let m: RegExpExecArray | null;
			while (m = VARIABLE_REGEXP.exec(line)) {
				const varRange = new vscode.Range(position.line, m.index, position.line, m.index + m[0].length);

				if (varRange.contains(position)) {
					return new vscode.EvaluatableExpression(varRange);
				}
			}
			return undefined;
		}
	}));

	// also register for tsx files
	context.subscriptions.push(vscode.languages.registerEvaluatableExpressionProvider('typescriptreact', {
		provideEvaluatableExpression(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.EvaluatableExpression> {

			const VARIABLE_REGEXP = /[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z_$][a-zA-Z0-9_$]*)*(\([^)]*\))?/g;
			const line = document.lineAt(position.line).text;

			let m: RegExpExecArray | null;
			while (m = VARIABLE_REGEXP.exec(line)) {
				const varRange = new vscode.Range(position.line, m.index, position.line, m.index + m[0].length);

				if (varRange.contains(position)) {
					return new vscode.EvaluatableExpression(varRange);
				}
			}
			return undefined;
		}
	}));

	// override VS Code's default implementation of the "inline values" feature for TypeScript
	context.subscriptions.push(vscode.languages.registerInlineValuesProvider('typescript', {

	provideInlineValues(document: vscode.TextDocument, viewport: vscode.Range, context: vscode.InlineValueContext): vscode.ProviderResult<vscode.InlineValue[]> {

		const allValues: vscode.InlineValue[] = [];

		for (let l = viewport.start.line; l <= context.stoppedLocation.end.line; l++) {
			const line = document.lineAt(l);
			// Match TypeScript variables including typed declarations
			const regExp = /(?:let|const|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)|([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[=:]/g;
			let m: RegExpExecArray | null;
			while ((m = regExp.exec(line.text)) !== null) {
				const varName = m[1] || m[2];
				if (varName) {
					const varRange = new vscode.Range(l, m.index, l, m.index + varName.length);

					// some literal text
					//allValues.push(new vscode.InlineValueText(varRange, `${varName}: ${viewport.start.line}`));

					// value found via variable lookup
					allValues.push(new vscode.InlineValueVariableLookup(varRange, varName, false));

					// value determined via expression evaluation
					//allValues.push(new vscode.InlineValueEvaluatableExpression(varRange, varName));
				}
			}
		}

		return allValues;
	}
	}));

	// also register inline values provider for tsx
	context.subscriptions.push(vscode.languages.registerInlineValuesProvider('typescriptreact', {

		provideInlineValues(document: vscode.TextDocument, viewport: vscode.Range, context: vscode.InlineValueContext) : vscode.ProviderResult<vscode.InlineValue[]> {

			const allValues: vscode.InlineValue[] = [];

			for (let l = viewport.start.line; l <= context.stoppedLocation.end.line; l++) {
				const line = document.lineAt(l);
				var regExp = /(?:let|const|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)|([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[=:]/g;
				do {
					var m = regExp.exec(line.text);
					if (m) {
						const varName = m[1] || m[2];
						if (varName) {
							const varRange = new vscode.Range(l, m.index, l, m.index + varName.length);
							allValues.push(new vscode.InlineValueVariableLookup(varRange, varName, false));
						}
					}
				} while (m);
			}

			return allValues;
		}
	}));
}

class TypeScriptConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && (editor.document.languageId === 'typescript' || editor.document.languageId === 'typescriptreact')) {
				config.type = 'typescript';
				config.name = 'Launch TypeScript';
				config.request = 'launch';
				config.program = '${file}';
				config.stopOnEntry = true;
				config.sourceMaps = true;
				config.outDir = '${workspaceFolder}/dist';
				config.skipFiles = ['<node_internals>/**'];
			}
		}

		if (!config.program) {
			return vscode.window.showInformationMessage("Cannot find a TypeScript program to debug").then(_ => {
				return undefined;	// abort launch
			});
		}

		// Ensure source maps are enabled for TypeScript debugging
		if (config.sourceMaps === undefined) {
			config.sourceMaps = true;
		}

		// Set default output directory if not specified
		if (!config.outDir && folder) {
			config.outDir = '${workspaceFolder}/dist';
		}

		// Skip node internals by default
		if (!config.skipFiles) {
			config.skipFiles = ['<node_internals>/**'];
		}

		// Enable source map path overrides for better debugging experience
		if (!config.sourceMapPathOverrides) {
			config.sourceMapPathOverrides = {
				"webpack:///./src/*": "${workspaceFolder}/src/*",
				"webpack:///./*": "${workspaceFolder}/*",
				"webpack:///src/*": "${workspaceFolder}/src/*",
				"webpack:///*": "*"
			};
		}

		return config;
	}
}

export const workspaceFileAccessor: FileAccessor = {
	isWindows: typeof process !== 'undefined' && process.platform === 'win32',
	async readFile(path: string): Promise<Uint8Array> {
		let uri: vscode.Uri;
		try {
			uri = pathToUri(path);
		} catch (e) {
			return new TextEncoder().encode(`cannot read '${path}'`);
		}

		return await vscode.workspace.fs.readFile(uri);
	},
	async writeFile(path: string, contents: Uint8Array) {
		await vscode.workspace.fs.writeFile(pathToUri(path), contents);
	}
};

function pathToUri(path: string) {
	try {
		return vscode.Uri.file(path);
	} catch (e) {
		return vscode.Uri.parse(path);
	}
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

	createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation(new MockDebugSession(workspaceFileAccessor));
	}

	// Add the dispose method to satisfy the type requirements
	dispose(): void {
		// Clean up any resources if needed
		// This method is called when the factory is disposed
	}
}