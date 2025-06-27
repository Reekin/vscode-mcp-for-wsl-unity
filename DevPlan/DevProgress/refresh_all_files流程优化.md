# refresh_project流程优化任务

## 任务描述
在refresh_project流程的最后加入：
1. 通知Unity执行project_files_refresher（通信参考 UnityMcpBridge/）
2. 然后执行 `await vscode.commands.executeCommand('dotnet.restartServer')`

## 技术分析
- 目前的refresh_project流程在refreshProject()函数中
- 需要添加HTTP请求调用Unity MCP Server的project_files_refresher工具
- Unity MCP通信端口需要确认（可能是固定端口或配置端口）
- 添加dotnet.restartServer命令执行

## 实现方案
1. 在refreshProject()函数末尾添加Unity MCP通信代码
2. 发送HTTP POST请求到Unity MCP Server调用project_files_refresher
3. 添加dotnet.restartServer命令执行
4. 添加错误处理和日志记录

## 进度
- [x] 分析现有代码结构
- [x] 实现Unity MCP通信功能
- [x] 添加dotnet.restartServer命令
- [x] 编译代码无错误
- [ ] 测试功能
- [ ] 提交代码

## 实现细节
1. 添加了net模块导入以支持TCP通信
2. 在refreshProject()函数末尾添加了notifyUnityProjectFilesRefresher()调用
3. 添加了dotnet.restartServer命令执行
4. 实现了notifyUnityProjectFilesRefresher()函数：
   - 使用TCP socket连接到Unity MCP Bridge
   - 发送project_files_refresher命令
   - 处理响应和错误
   - 支持WSL环境下的192.168.80.1主机地址配置
5. 添加了配置项unityMcpHost和unityMcpPort以支持自定义配置