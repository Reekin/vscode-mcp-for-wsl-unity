"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const http = require("http");
const path = require("path");
let server = null;
let outputChannel;
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('File Refresher');
    // 注册命令
    const startCommand = vscode.commands.registerCommand('fileRefresher.start', startServer);
    const stopCommand = vscode.commands.registerCommand('fileRefresher.stop', stopServer);
    const refreshCommand = vscode.commands.registerCommand('fileRefresher.refreshAll', refreshAllFiles);
    context.subscriptions.push(startCommand, stopCommand, refreshCommand, outputChannel);
    // 自动启动
    const config = vscode.workspace.getConfiguration('fileRefresher');
    if (config.get('autoStart', true)) {
        startServer();
    }
}
exports.activate = activate;
function deactivate() {
    stopServer();
}
exports.deactivate = deactivate;
async function startServer() {
    if (server) {
        log('服务器已在运行');
        return;
    }
    const config = vscode.workspace.getConfiguration('fileRefresher');
    const port = config.get('port', 8790);
    server = http.createServer(handleRequest);
    server.listen(port, 'localhost', () => {
        log(`文件刷新服务器启动在端口 ${port}`);
        vscode.window.showInformationMessage(`File Refresher 服务器启动在端口 ${port}`);
    });
    server.on('error', (error) => {
        log(`服务器错误: ${error.message}`);
        vscode.window.showErrorMessage(`File Refresher 服务器错误: ${error.message}`);
        server = null;
    });
}
function stopServer() {
    if (server) {
        server.close();
        server = null;
        log('服务器已停止');
        vscode.window.showInformationMessage('File Refresher 服务器已停止');
    }
}
async function handleRequest(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    if (req.method === 'POST' && req.url === '/refresh') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                await handleRefreshRequest(data);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: '文件刷新完成' }));
            }
            catch (error) {
                log(`处理刷新请求错误: ${error}`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
            }
        });
    }
    else {
        res.writeHead(404);
        res.end('Not Found');
    }
}
async function handleRefreshRequest(data) {
    const { files, action = 'refresh' } = data;
    log(`收到刷新请求: ${action}, 文件: ${files?.join(', ') || '全部'}`);
    if (action === 'refresh') {
        if (files && Array.isArray(files)) {
            // 刷新指定文件
            for (const filePath of files) {
                await refreshFile(filePath);
            }
        }
        else {
            // 刷新所有打开的文件
            await refreshAllFiles();
        }
    }
    else if (action === 'refresh_project') {
        // 刷新整个项目
        await refreshProject();
    }
    // 触发诊断检查
    await triggerDiagnostics();
}
async function refreshFile(filePath) {
    try {
        const uri = vscode.Uri.file(path.resolve(filePath));
        await vscode.workspace.openTextDocument(uri);
        // 强制刷新文档内容
        await vscode.commands.executeCommand('workbench.action.files.revert', uri);
        log(`已刷新文件: ${filePath}`);
    }
    catch (error) {
        log(`刷新文件失败 ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function refreshAllFiles() {
    const openDocuments = vscode.workspace.textDocuments;
    for (const document of openDocuments) {
        if (!document.isUntitled && document.uri.scheme === 'file') {
            try {
                await vscode.commands.executeCommand('workbench.action.files.revert', document.uri);
            }
            catch (error) {
                log(`刷新文件失败 ${document.uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    log(`已刷新 ${openDocuments.length} 个打开的文件`);
}
async function refreshProject() {
    try {
        // 刷新文件资源管理器
        await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
        // 刷新所有已打开的文档（包括未显示的）
        await refreshAllFiles();
        // 如果有工作区文件夹，遍历并刷新所有文件
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            let refreshedCount = 0;
            for (const folder of workspaceFolders) {
                const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), '**/node_modules/**');
                for (const fileUri of files) {
                    try {
                        // 如果文件已经在编辑器中打开，刷新它
                        const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === fileUri.toString());
                        if (document) {
                            await vscode.commands.executeCommand('workbench.action.files.revert', fileUri);
                            refreshedCount++;
                        }
                    }
                    catch (error) {
                        // 忽略单个文件的刷新错误
                    }
                }
            }
            log(`已刷新整个项目，包含 ${refreshedCount} 个文件`);
        }
        else {
            log('已刷新项目（无工作区文件夹）');
        }
    }
    catch (error) {
        log(`刷新项目失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function triggerDiagnostics() {
    try {
        // 触发语言服务器诊断
        await vscode.commands.executeCommand('typescript.reloadProjects');
        await vscode.commands.executeCommand('python.refreshDiagnostics');
        // 通用的诊断刷新
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            await vscode.commands.executeCommand('editor.action.marker.next');
            await vscode.commands.executeCommand('editor.action.marker.prev');
        }
        log('已触发诊断检查');
    }
    catch (error) {
        log(`触发诊断检查失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function log(message) {
    const config = vscode.workspace.getConfiguration('fileRefresher');
    if (config.get('enableLogging', false)) {
        outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
    }
}
//# sourceMappingURL=extension.js.map