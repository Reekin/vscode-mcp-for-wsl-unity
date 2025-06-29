import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import * as net from 'net';

let server: http.Server | null = null;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('VSCode MCP Bridge');
    
    // Register commands
    const startCommand = vscode.commands.registerCommand('vscodeMcpBridge.start', startServer);
    const stopCommand = vscode.commands.registerCommand('vscodeMcpBridge.stop', stopServer);
    const refreshCommand = vscode.commands.registerCommand('vscodeMcpBridge.refreshAll', () => refreshFiles());
    
    context.subscriptions.push(startCommand, stopCommand, refreshCommand, outputChannel);
    
    // Auto start
    const config = vscode.workspace.getConfiguration('vscodeMcpBridge');
    if (config.get('autoStart', true)) {
        startServer();
    }
}

export function deactivate() {
    stopServer();
}

async function startServer() {
    if (server) {
        log('Server is already running');
        return;
    }
    
    const config = vscode.workspace.getConfiguration('vscodeMcpBridge');
    const port = config.get('port', 8790);
    
    server = http.createServer(handleRequest);
    
    server.listen(port, 'localhost', () => {
        log(`File refresh server started on port ${port}`);
        vscode.window.showInformationMessage(`VSCode MCP Bridge server started on port ${port}`);
    });
    
    server.on('error', (error) => {
        log(`Server error: ${error.message}`);
        vscode.window.showErrorMessage(`VSCode MCP Bridge server error: ${error.message}`);
        server = null;
    });
}

function stopServer() {
    if (server) {
        server.close();
        server = null;
        log('Server stopped');
        vscode.window.showInformationMessage('VSCode MCP Bridge server stopped');
    }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    if (req.method === 'POST' && req.url === '/bridge') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const result = await handleBridgeRequest(data);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                
                if (data.action === 'goto_symbol_definition') {
                    // Return symbol definition result
                    res.end(JSON.stringify({ 
                        success: true, 
                        message: result ? 'Symbol definition search completed' : 'Symbol definition not found',
                        definitions: result || []
                    }));
                } else {
                    // Return normal operation result
                    res.end(JSON.stringify({ success: true, message: 'Operation completed' }));
                }
                
            } catch (error) {
                log(`Request processing error: ${error}`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
}

async function handleBridgeRequest(data: any) {
    const { files, action, file_path, line, character } = data;
    
    log(`Received request: ${action}, files: ${files?.join(', ') || file_path || 'all'}`);
    
    if (action === 'refresh_project') {
        // Refresh project, support specified file list
        await refreshProject(files);
        // Trigger diagnostic check
        await triggerDiagnostics();
    } else if (action === 'goto_symbol_definition') {
        // View symbol definition
        return await gotoSymbolDefinition(file_path, line, character);
    }
}

async function refreshFiles(filePaths: string[] = []) {
    try {
        if (filePaths.length === 0) {
            // If no file paths specified, refresh all open files
            const openDocuments = vscode.workspace.textDocuments;
            
            for (const document of openDocuments) {
                if (!document.isUntitled && document.uri.scheme === 'file') {
                    try {
                        await vscode.commands.executeCommand('workbench.action.files.revert', document.uri);
                    } catch (error) {
                        log(`Failed to refresh file ${document.uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            }
            
            log(`Refreshed ${openDocuments.length} open files`);
        } else {
            // Refresh specified file list
            const openDocuments = vscode.workspace.textDocuments;
            const openFiles = new Set(openDocuments.map(doc => doc.uri.fsPath));
            
            for (const filePath of filePaths) {
                try {
                    const resolvedPath = path.resolve(filePath);
                    const uri = vscode.Uri.file(resolvedPath);
                    
                    // If file is not open, open it first
                    if (!openFiles.has(resolvedPath)) {
                        await vscode.workspace.openTextDocument(uri);
                    }
                    
                    // Refresh file content
                    await vscode.commands.executeCommand('workbench.action.files.revert', uri);
                    
                    log(`Refreshed file: ${filePath}`);
                    
                } catch (error) {
                    log(`Failed to refresh file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            
            log(`Refreshed ${filePaths.length} specified files`);
        }
        
    } catch (error) {
        log(`File refresh operation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function waitForDotnetAnalysisComplete(timeoutMs: number = 30000): Promise<void> {
    return new Promise((resolve) => {
        const startTime = Date.now();
        let isResolved = false;
        let diagnosticChangeCount = 0;
        let lastChangeTime = startTime;
        
        // Set timeout
        const timeout = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                log('Waiting for dotnet analysis completion timeout, continuing...');
                resolve();
            }
        }, timeoutMs);
        
        // Listen to diagnostic change events
        const disposable = vscode.languages.onDidChangeDiagnostics((event) => {
            if (isResolved) return;
            
            // Record diagnostic changes
            const currentTime = Date.now();
            diagnosticChangeCount++;
            
            // Check if changed URIs contain C# files
            let hasCSharpChanges = false;
            for (const uri of event.uris) {
                if (uri.fsPath.endsWith('.cs')) {
                    hasCSharpChanges = true;
                    break;
                }
            }
            
            if (hasCSharpChanges) {
                log(`Detected C# diagnostic change (${diagnosticChangeCount} times)`);
            }
            
            // If enough initial wait time has passed and no recent frequent diagnostic changes, consider analysis complete
            const timeSinceLastChange = currentTime - lastChangeTime;
            
            if (timeSinceLastChange > 3000) {
                isResolved = true;
                clearTimeout(timeout);
                disposable.dispose();
                log(`dotnet analysis completed (detected ${diagnosticChangeCount} diagnostic changes)`);
                resolve();
            }
            lastChangeTime = currentTime;
        });
        
        // Fallback check: if no diagnostic changes for a long time, consider analysis complete
        const config = vscode.workspace.getConfiguration('vscodeMcpBridge');
        const fallbackDelay = config.get('dotnetAnalysisTimeout', 10000);
        
        setTimeout(() => {
            if (isResolved) return;
            
            const currentTime = Date.now();
            const timeSinceLastChange = currentTime - lastChangeTime;
            
            // If no diagnostic changes for more than 5 seconds and minimum wait time passed, consider complete
            if (timeSinceLastChange > 5000 && (currentTime - startTime) > 12000) {
                isResolved = true;
                clearTimeout(timeout);
                disposable.dispose();
                log(`No recent diagnostic changes detected, considering dotnet analysis complete (${diagnosticChangeCount} changes total)`);
                resolve();
            }
        }, fallbackDelay);
    });
}

async function refreshProject(filePaths?: string[]) {
    try {
        log(`Starting project refresh... ${filePaths ? `specified files: ${filePaths.join(', ')}` : 'all files'}`);
        
        // 1. Refresh file explorer
        await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
        
        // 2. Refresh documents (if file paths specified, only refresh these files; otherwise refresh all open documents)
        await refreshFiles(filePaths);
        
        // 3. Trigger language servers to reload projects
        try {
            await vscode.commands.executeCommand('typescript.reloadProjects');
        } catch (e) {
            // TypeScript server may not exist, ignore error
        }
        
        try {
            await vscode.commands.executeCommand('python.reloadProjects');
        } catch (e) {
            // Python server may not exist, ignore error
        }
        
        // Unity/C# related server reload
        try {
            await vscode.commands.executeCommand('omnisharp.restartServer');
        } catch (e) {
            // OmniSharp may not exist, ignore error
        }
        
        try {
            await vscode.commands.executeCommand('csharp.reloadProjects');
        } catch (e) {
            // C# server may not exist, ignore error
        }
        
        try {
            await vscode.commands.executeCommand('dotnet.restore');
        } catch (e) {
            // dotnet may not exist, ignore error
        }
        
        // 4. Notify Unity to execute project_files_refresher
        try {
            await notifyUnityProjectFilesRefresher();
        } catch (e) {
            log(`Unity project_files_refresher notification failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 5. Restart dotnet server and wait for analysis completion
        try {
            await vscode.commands.executeCommand('dotnet.restartServer');
            log('Restarted dotnet server, waiting for analysis completion...');
            await waitForDotnetAnalysisComplete();
            log('dotnet server analysis completed');
        } catch (e) {
            log(`Failed to restart dotnet server: ${e instanceof Error ? e.message : String(e)}`);
        }
        
        log('Project refresh completed');
        
    } catch (error) {
        log(`Project refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}


async function triggerDiagnostics() {
    try {
        // Trigger language server diagnostics
        await vscode.commands.executeCommand('typescript.reloadProjects');
        await vscode.commands.executeCommand('python.refreshDiagnostics');
        
        // Generic diagnostic refresh
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            await vscode.commands.executeCommand('editor.action.marker.next');
            await vscode.commands.executeCommand('editor.action.marker.prev');
        }
        
        log('Triggered diagnostic check');
        
    } catch (error) {
        log(`Failed to trigger diagnostic check: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function gotoSymbolDefinition(filePath: string, line: number, character: number): Promise<any[]> {
    try {
        log(`Starting symbol definition search: ${filePath}:${line}:${character}`);
        
        // Convert file path to VSCode URI
        const uri = vscode.Uri.file(path.resolve(filePath));
        
        // Ensure document is open
        await vscode.workspace.openTextDocument(uri);
        
        // Create position object (VSCode API uses 0-based line numbers)
        const position = new vscode.Position(line - 1, character);
        
        // Call VSCode's Go to Definition API
        const definitions = await vscode.commands.executeCommand<vscode.LocationLink[] | vscode.Location[]>(
            'vscode.executeDefinitionProvider',
            uri,
            position
        );
        
        if (!definitions || definitions.length === 0) {
            log('Symbol definition not found');
            return [];
        }
        
        // Convert definition results to standard format
        const results = definitions.map((def, index) => {
            let location: vscode.Location;
            let targetRange: vscode.Range;
            
            // Handle both LocationLink and Location types
            if ('targetUri' in def) {
                // LocationLink type
                location = new vscode.Location(def.targetUri, def.targetRange);
                targetRange = def.targetRange;
            } else {
                // Location type
                location = def as vscode.Location;
                targetRange = location.range;
            }
            
            const result = {
                uri: location.uri.fsPath,
                range: {
                    start: {
                        line: targetRange.start.line,
                        character: targetRange.start.character
                    },
                    end: {
                        line: targetRange.end.line,
                        character: targetRange.end.character
                    }
                }
            };
            
            log(`Definition ${index + 1}: ${result.uri}:${result.range.start.line + 1}:${result.range.start.character + 1}`);
            return result;
        });
        
        log(`Found ${results.length} definitions`);
        return results;
        
    } catch (error) {
        log(`Symbol definition search failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}

async function notifyUnityProjectFilesRefresher() {
    const config = vscode.workspace.getConfiguration('vscodeMcpBridge');
    const unityMcpPort = config.get('unityMcpPort', 6400);
    const unityMcpHost = config.get('unityMcpHost', '192.168.80.1'); // WSL default gateway to access Windows
    
    return new Promise<void>((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(5000); // 5 second timeout
        
        const command = {
            type: 'project_files_refresher',
            params: {}
        };
        
        const commandJson = JSON.stringify(command);
        
        socket.connect(unityMcpPort, unityMcpHost, () => {
            log(`Connected to Unity MCP Bridge (${unityMcpHost}:${unityMcpPort})`);
            socket.write(commandJson);
        });
        
        socket.on('data', (data) => {
            try {
                const response = JSON.parse(data.toString());
                log(`Unity MCP response: ${JSON.stringify(response)}`);
                
                if (response.status === 'success') {
                    log('Unity project_files_refresher executed successfully');
                    resolve();
                } else {
                    reject(new Error(`Unity MCP error: ${response.error || 'unknown error'}`));
                }
            } catch (error) {
                log(`Failed to parse Unity MCP response: ${error instanceof Error ? error.message : String(error)}`);
                reject(error);
            }
            socket.destroy();
        });
        
        socket.on('error', (error) => {
            log(`Unity MCP connection error: ${error.message}`);
            reject(error);
        });
        
        socket.on('timeout', () => {
            log('Unity MCP connection timeout');
            socket.destroy();
            reject(new Error('Unity MCP connection timeout'));
        });
        
        socket.on('close', () => {
            log('Unity MCP connection closed');
        });
    });
}

function log(message: string) {
    const config = vscode.workspace.getConfiguration('vscodeMcpBridge');
    if (config.get('enableLogging', false)) {
        outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
    }
}