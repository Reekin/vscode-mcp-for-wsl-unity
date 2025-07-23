import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import * as net from 'net';
import * as fs from 'fs';

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

function formatDiagnosticResults(diagnosticResults: Map<string, vscode.Diagnostic[]> | null): any {
    if (!diagnosticResults) {
        return null;
    }
    
    const formattedResults: any = {};
    const summary = {
        totalErrors: 0,
        totalWarnings: 0,
        filesWithIssues: 0
    };
    
    for (const [filePath, diagnostics] of diagnosticResults) {
        const errorsAndWarnings = diagnostics.filter(d => 
            d.severity === vscode.DiagnosticSeverity.Error || 
            d.severity === vscode.DiagnosticSeverity.Warning
        );
        
        if (errorsAndWarnings.length > 0) {
            summary.filesWithIssues++;
            formattedResults[filePath] = errorsAndWarnings.map(diagnostic => ({
                line: diagnostic.range.start.line + 1,
                column: diagnostic.range.start.character + 1,
                severity: diagnostic.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning',
                message: diagnostic.message,
                source: diagnostic.source || 'unknown'
            }));
            
            // Update counters
            summary.totalErrors += errorsAndWarnings.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
            summary.totalWarnings += errorsAndWarnings.filter(d => d.severity === vscode.DiagnosticSeverity.Warning).length;
        }
    }
    
    return {
        summary,
        diagnostics: formattedResults
    };
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
                } else if (data.action === 'refresh_project') {
                    // Return refresh project result with diagnostics
                    const formattedDiagnostics = formatDiagnosticResults(result);
                    res.end(JSON.stringify({ 
                        success: true, 
                        message: 'Project refresh completed',
                        diagnostics: formattedDiagnostics
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
    const { files, action, file_path, line, character, is_add } = data;
    
    log(`Received request: ${action}, files: ${files?.join(', ') || file_path || 'all'}, is_add: ${is_add}`);
    
    if (action === 'refresh_project') {
        // Refresh project, support specified file list
        const diagnosticResults = await refreshProject(files, is_add);
        return diagnosticResults;
    } else if (action === 'goto_symbol_definition') {
        // View symbol definition
        return await gotoSymbolDefinition(file_path, line, character);
    }
}

// Commented out old version of refreshFiles function
/*
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
                    
                    // If file is not open, open it in the editor first
                    if (!openFiles.has(resolvedPath)) {
                        const document = await vscode.workspace.openTextDocument(uri);
                        await vscode.window.showTextDocument(document);
                    }
                    
                    // Refresh file content
                    await vscode.commands.executeCommand('workbench.action.files.revert', uri);
                    
                    // Force trigger diagnostics by briefly focusing the document
                    try {
                        const document = await vscode.workspace.openTextDocument(uri);
                        await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
                        
                        // Small delay to ensure the language server processes the file
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                        // Trigger manual diagnostic refresh if available
                        try {
                            await vscode.commands.executeCommand('workbench.action.problems.focus');
                        } catch (e) {
                            // Ignore if command not available
                        }
                    } catch (diagError) {
                        log(`Failed to trigger diagnostics for ${filePath}: ${diagError instanceof Error ? diagError.message : String(diagError)}`);
                    }
                    
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
*/

// To solve the issue where VSCode cannot promptly detect file changes made by terminal in remote WSL environment, additional manual refresh operations are needed
async function refreshFiles(filePaths: string[] = [], skipDiagnostics?: boolean): Promise<Map<string, vscode.Diagnostic[]> | null> {
    try {
        log(`Starting lightweight file refresh${skipDiagnostics ? ' (skipping diagnostics)' : ' and diagnostics check'}`);
        const startTime = Date.now();
        
        const targetFiles = filePaths.length > 0 ? filePaths : 
            vscode.workspace.textDocuments
                .filter(doc => !doc.isUntitled && doc.uri.scheme === 'file')
                .map(doc => doc.uri.fsPath);
        
        log(`Target files (${targetFiles.length}): ${targetFiles.join(', ')}`);
        
        const diagnosticResults = new Map<string, vscode.Diagnostic[]>();
        
        for (const filePath of targetFiles) {
            try {
                const resolvedPath = path.resolve(filePath);
                const uri = vscode.Uri.file(resolvedPath);
                
                log(`Processing file: ${resolvedPath}`);
                
                // Step 1: Check if file is already open and force revert if needed
                const openDocuments = vscode.workspace.textDocuments;
                const existingDocument = openDocuments.find(doc => doc.uri.fsPath === resolvedPath);
                
                if (existingDocument) {
                    log(`File already open, forcing revert: ${resolvedPath}`);
                    try {
                        // Force revert the document to disk content
                        await vscode.commands.executeCommand('workbench.action.files.revert', uri);
                        log(`Successfully reverted file: ${resolvedPath}`);
                    } catch (error) {
                        log(`Failed to revert file ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
                
                // Step 2: Ensure file is opened and get latest content
                let document: vscode.TextDocument;
                try {
                    document = await vscode.workspace.openTextDocument(uri);
                    log(`Document opened, isDirty: ${document.isDirty}, version: ${document.version}`);
                } catch (error) {
                    log(`Failed to open document ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`);
                    continue;
                }
                
                // Step 3: Read disk content for comparison
                const diskContent = fs.readFileSync(resolvedPath, 'utf8');
                
                // Step 4: Notify language server of file changes
                try {
                    // Trigger document update event
                    await vscode.window.showTextDocument(document, { 
                        preview: true, 
                        preserveFocus: true,
                        viewColumn: vscode.ViewColumn.Active 
                    });
                    
                    // Use fs module to read file content to ensure latest content
                    const vscodeContent = document.getText();
                    
                    log(`File content comparison:`);
                    log(`   - Disk content length: ${diskContent.length}`);
                    log(`   - VSCode content length: ${vscodeContent.length}`);
                    log(`   - Content match: ${diskContent === vscodeContent}`);
                    
                    log(`Language server notified of file changes`);
                } catch (error) {
                    log(`Failed to notify language server: ${error instanceof Error ? error.message : String(error)}`);
                }
                
                // Step 5: Get diagnostic information (skip if requested)
                if (!skipDiagnostics) {
                    const diagnostics = vscode.languages.getDiagnostics(uri);
                    diagnosticResults.set(resolvedPath, diagnostics);
                    
                    log(`Diagnostics for ${path.basename(resolvedPath)}:`);
                    log(`   - Total diagnostics: ${diagnostics.length}`);
                    
                    if (diagnostics.length > 0) {
                        for (const [index, diagnostic] of diagnostics.entries()) {
                            const severity = diagnostic.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' :
                                           diagnostic.severity === vscode.DiagnosticSeverity.Warning ? 'WARNING' :
                                           diagnostic.severity === vscode.DiagnosticSeverity.Information ? 'INFO' : 'HINT';
                            
                            log(`   [${index + 1}] ${severity} at line ${diagnostic.range.start.line + 1}: ${diagnostic.message}`);
                        }
                    } else {
                        log(`   No diagnostics found`);
                    }
                } else {
                    log(`Skipping diagnostics check for ${path.basename(resolvedPath)} (skipDiagnostics=true)`);
                }
                
                log(`Completed processing: ${resolvedPath}`);
                
            } catch (error) {
                log(`Failed to process file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        
        // Final summary
        const endTime = Date.now();
        
        if (!skipDiagnostics) {
            const totalErrors = Array.from(diagnosticResults.values())
                .flat()
                .filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
            const totalWarnings = Array.from(diagnosticResults.values())
                .flat()
                .filter(d => d.severity === vscode.DiagnosticSeverity.Warning).length;
            
            log(`Refresh completed in ${endTime - startTime}ms:`);
            log(`   - Files processed: ${targetFiles.length}`);
            log(`   - Total errors: ${totalErrors}`);
            log(`   - Total warnings: ${totalWarnings}`);
            log(`   - Files with diagnostics: ${Array.from(diagnosticResults.entries()).filter(([_, diags]) => diags.length > 0).length}`);
        } else {
            log(`Refresh completed in ${endTime - startTime}ms (diagnostics skipped):`);
            log(`   - Files processed: ${targetFiles.length}`);
        }
        
        // Return diagnostic results if they were collected
        return skipDiagnostics ? null : diagnosticResults;
        
    } catch (error) {
        log(`File refresh operation failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

async function waitForDotnetAnalysisComplete(timeoutMs: number = 30000): Promise<void> {
    return new Promise((resolve) => {
        const startTime = Date.now();
        let isResolved = false;
        let diagnosticChangeCount = 0;
        let csharpChangeCount = 0;
        let lastChangeTime = startTime;
        let stableTimeMs = 3000; // Wait for 3 seconds of stability
        
        const config = vscode.workspace.getConfiguration('vscodeMcpBridge');
        const fallbackDelay = config.get('dotnetAnalysisTimeout', 10000);
        
        const cleanup = () => {
            if (timeout) clearTimeout(timeout);
            if (fallbackTimeout) clearTimeout(fallbackTimeout);
            if (disposable) disposable.dispose();
        };
        
        const resolveOnce = (reason: string) => {
            if (!isResolved) {
                isResolved = true;
                cleanup();
                log(`dotnet analysis ${reason} (total changes: ${diagnosticChangeCount}, C# changes: ${csharpChangeCount})`);
                resolve();
            }
        };
        
        // Main timeout
        const timeout = setTimeout(() => {
            resolveOnce('timeout');
        }, timeoutMs);
        
        // Listen to diagnostic change events
        const disposable = vscode.languages.onDidChangeDiagnostics((event) => {
            if (isResolved) return;
            
            const currentTime = Date.now();
            diagnosticChangeCount++;
            
            // Check if changed URIs contain C# files
            let hasCSharpChanges = false;
            for (const uri of event.uris) {
                if (uri.fsPath.endsWith('.cs')) {
                    hasCSharpChanges = true;
                    csharpChangeCount++;
                    break;
                }
            }
            
            if (hasCSharpChanges) {
                log(`Detected C# diagnostic change (${csharpChangeCount}/${diagnosticChangeCount})`);
                lastChangeTime = currentTime;
                
                // Reset stability timer when we get C# changes
                if (stableTimeout) clearTimeout(stableTimeout);
                stableTimeout = setTimeout(() => {
                    resolveOnce('completed after stability period');
                }, stableTimeMs);
            }
        });
        
        // Fallback timeout for when no changes are detected
        const fallbackTimeout = setTimeout(() => {
            resolveOnce('completed (no changes detected)');
        }, fallbackDelay);
        
        // Stability timeout (will be reset on C# changes)
        let stableTimeout: NodeJS.Timeout | null = null;
        
        log(`Waiting for dotnet analysis (max ${timeoutMs}ms, fallback ${fallbackDelay}ms, stability ${stableTimeMs}ms)`);
    });
}

async function refreshProject(filePaths?: string[], isAdd?: boolean): Promise<Map<string, vscode.Diagnostic[]> | null> {
    try {
        log(`Starting project refresh... ${filePaths ? `specified files: ${filePaths.join(', ')}` : 'all files'}, isAdd: ${isAdd}`);
        
        try {
            await notifyUnityProjectFilesRefresher();
        } catch (e) {
            log(`Unity project_files_refresher notification failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));

        await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
        
        const diagnosticResults = await refreshFiles(filePaths, isAdd);
        
        await new Promise(resolve => setTimeout(resolve, 300));

        if(isAdd) {
            // 4. Restart dotnet server and wait for analysis completion
            setTimeout(async () => {
                try {
                    await vscode.commands.executeCommand('dotnet.restartServer');
                    log('Restarted dotnet server, waiting for analysis completion...');

                        await waitForDotnetAnalysisComplete();

                    log('dotnet server analysis completed');
                } catch (e) {
                    log(`Failed to restart dotnet server: ${e instanceof Error ? e.message : String(e)}`);
                }
            }, 3000);
        }
        
        log('Project refresh completed');
        return diagnosticResults;
        
    } catch (error) {
        log(`Project refresh failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
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
    const hostIP = await getHostIp();
    log(`Default HostIp is ${hostIP}`);
    const unityMcpHost = config.get('unityMcpHost', hostIP); // WSL default gateway to access Windows
    
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

async function getHostIp(): Promise<string> {
  // process.platform 在 WSL 中通常是 'linux'
  if (process.platform !== 'linux') {
    return 'localhost';
  }
  
  const resolvConfPath = '/etc/resolv.conf';

  try {
    const fileContent = fs.readFileSync(resolvConfPath, 'utf8');
    const lines = fileContent.split('\n');
    
    // 寻找以 "nameserver" 开头的那一行
    const nameserverLine = lines.find((line: string) => line.trim().startsWith('nameserver'));

    if (nameserverLine) {
      const ipAddress = nameserverLine.trim().split(/\s+/)[1];
      return ipAddress;
    }

    return 'localhost';
  } catch (error) {
    console.error(`读取或解析 ${resolvConfPath} 时出错:`, error);
    return 'localhost';
  }
}

function log(message: string) {
    const config = vscode.workspace.getConfiguration('vscodeMcpBridge');
    if (config.get('enableLogging', false)) {
        outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
    }
}