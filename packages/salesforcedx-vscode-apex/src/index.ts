/*
 * Copyright (c) 2017, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { getTestResultsFolder } from '@salesforce/salesforcedx-utils-vscode';
import * as path from 'path';
import * as vscode from 'vscode';
import { ApexLanguageClient } from './apexLanguageClient';
import ApexLSPStatusBarItem from './apexLspStatusBarItem';
import { CodeCoverage, StatusBarToggle } from './codecoverage';

import {
  anonApexDebug,
  anonApexExecute,
  apexDebugClassRunCodeActionDelegate,
  apexDebugMethodRunCodeActionDelegate,
  apexLogGet,
  apexTestClassRunCodeAction,
  apexTestClassRunCodeActionDelegate,
  apexTestMethodRunCodeAction,
  apexTestMethodRunCodeActionDelegate,
  apexTestRun,
  apexTestSuiteAdd,
  apexTestSuiteCreate,
  apexTestSuiteRun,
  launchApexReplayDebuggerWithCurrentFile
} from './commands';
import { API, SET_JAVA_DOC_LINK } from './constants';
import { workspaceContext } from './context';
import * as languageServer from './languageServer';
import { languageServerOrphanHandler as lsoh } from './languageServerOrphanHandler';
import {
  ClientStatus,
  enableJavaDocSymbols,
  extensionUtils,
  getApexTests,
  getExceptionBreakpointInfo,
  getLineBreakpointInfo,
  languageClientUtils
} from './languageUtils';
import { nls } from './messages';
import { retrieveEnableSyncInitJobs } from './settings';
import { telemetryService } from './telemetry';
import { getTestOutlineProvider } from './views/testOutlineProvider';
import { ApexTestRunner, TestRunType } from './views/testRunner';

export const activate = async (extensionContext: vscode.ExtensionContext) => {
  const extensionHRStart = process.hrtime();
  const languageServerStatusBarItem = new ApexLSPStatusBarItem();
  const testOutlineProvider = getTestOutlineProvider();
  if (vscode.workspace && vscode.workspace.workspaceFolders) {
    const apexDirPath = getTestResultsFolder(
      vscode.workspace.workspaceFolders[0].uri.fsPath,
      'apex'
    );

    const testResultOutput = path.join(apexDirPath, '*.json');
    const testResultFileWatcher =
      vscode.workspace.createFileSystemWatcher(testResultOutput);
    testResultFileWatcher.onDidCreate(uri =>
      testOutlineProvider.onResultFileCreate(apexDirPath, uri.fsPath)
    );
    testResultFileWatcher.onDidChange(uri =>
      testOutlineProvider.onResultFileCreate(apexDirPath, uri.fsPath)
    );

    extensionContext.subscriptions.push(testResultFileWatcher);
  } else {
    throw new Error(nls.localize('cannot_determine_workspace'));
  }

  // Workspace Context
  await workspaceContext.initialize(extensionContext);

  // Telemetry
  await telemetryService.initializeService(extensionContext);

  // start the language server and client
  await createLanguageClient(extensionContext, languageServerStatusBarItem);

  // Javadoc support
  enableJavaDocSymbols();

  // Commands
  const commands = registerCommands();
  extensionContext.subscriptions.push(commands);

  extensionContext.subscriptions.push(await registerTestView());

  const exportedApi = {
    getLineBreakpointInfo,
    getExceptionBreakpointInfo,
    getApexTests,
    languageClientUtils
  };

  telemetryService.sendExtensionActivationEvent(extensionHRStart);
  return exportedApi;
};

const registerCommands = (): vscode.Disposable => {
  // Colorize code coverage
  const statusBarToggle = new StatusBarToggle();
  const colorizer = new CodeCoverage(statusBarToggle);
  const apexToggleColorizerCmd = vscode.commands.registerCommand(
    'sfdx.apex.toggle.colorizer',
    () => colorizer.toggleCoverage()
  );

  // Customer-facing commands
  const apexTestClassRunDelegateCmd = vscode.commands.registerCommand(
    'sfdx.apex.test.class.run.delegate',
    apexTestClassRunCodeActionDelegate
  );
  const apexTestLastClassRunCmd = vscode.commands.registerCommand(
    'sfdx.apex.test.last.class.run',
    apexTestClassRunCodeAction
  );
  const apexTestClassRunCmd = vscode.commands.registerCommand(
    'sfdx.apex.test.class.run',
    apexTestClassRunCodeAction
  );
  const apexTestMethodRunDelegateCmd = vscode.commands.registerCommand(
    'sfdx.apex.test.method.run.delegate',
    apexTestMethodRunCodeActionDelegate
  );
  const apexDebugClassRunDelegateCmd = vscode.commands.registerCommand(
    'sfdx.apex.debug.class.run.delegate',
    apexDebugClassRunCodeActionDelegate
  );
  const apexDebugMethodRunDelegateCmd = vscode.commands.registerCommand(
    'sfdx.apex.debug.method.run.delegate',
    apexDebugMethodRunCodeActionDelegate
  );
  const anonApexRunDelegateCmd = vscode.commands.registerCommand(
    'sfdx.force.anon.apex.run.delegate',
    anonApexExecute
  );
  const anonApexDebugDelegateCmd = vscode.commands.registerCommand(
    'sfdx.force.anon.apex.debug.delegate',
    anonApexDebug
  );
  const apexLogGetCmd = vscode.commands.registerCommand(
    'sfdx.apex.log.get',
    apexLogGet
  );
  const apexTestLastMethodRunCmd = vscode.commands.registerCommand(
    'sfdx.apex.test.last.method.run',
    apexTestMethodRunCodeAction
  );
  const apexTestMethodRunCmd = vscode.commands.registerCommand(
    'sfdx.apex.test.method.run',
    apexTestMethodRunCodeAction
  );
  const apexTestSuiteCreateCmd = vscode.commands.registerCommand(
    'sfdx.apex.test.suite.create',
    apexTestSuiteCreate
  );
  const apexTestSuiteRunCmd = vscode.commands.registerCommand(
    'sfdx.apex.test.suite.run',
    apexTestSuiteRun
  );
  const apexTestSuiteAddCmd = vscode.commands.registerCommand(
    'sfdx.apex.test.suite.add',
    apexTestSuiteAdd
  );
  const apexTestRunCmd = vscode.commands.registerCommand(
    'sfdx.apex.test.run',
    apexTestRun
  );
  const anonApexExecuteDocumentCmd = vscode.commands.registerCommand(
    'sfdx.anon.apex.execute.document',
    anonApexExecute
  );
  const anonApexDebugDocumentCmd = vscode.commands.registerCommand(
    'sfdx.apex.debug.document',
    anonApexDebug
  );
  const anonApexExecuteSelectionCmd = vscode.commands.registerCommand(
    'sfdx.anon.apex.execute.selection',
    anonApexExecute
  );
  const launchApexReplayDebuggerWithCurrentFileCmd =
    vscode.commands.registerCommand(
      'sfdx.launch.apex.replay.debugger.with.current.file',
      launchApexReplayDebuggerWithCurrentFile
    );

  return vscode.Disposable.from(
    anonApexDebugDelegateCmd,
    anonApexDebugDocumentCmd,
    anonApexExecuteDocumentCmd,
    anonApexExecuteSelectionCmd,
    anonApexRunDelegateCmd,
    apexDebugClassRunDelegateCmd,
    apexDebugMethodRunDelegateCmd,
    apexLogGetCmd,
    apexTestClassRunCmd,
    apexTestClassRunDelegateCmd,
    apexTestLastClassRunCmd,
    apexTestLastMethodRunCmd,
    apexTestMethodRunCmd,
    apexTestMethodRunDelegateCmd,
    apexTestRunCmd,
    apexToggleColorizerCmd,
    apexTestSuiteCreateCmd,
    apexTestSuiteRunCmd,
    apexTestSuiteAddCmd,
    launchApexReplayDebuggerWithCurrentFileCmd
  );
};

const registerTestView = (): vscode.Disposable => {
  const testOutlineProvider = getTestOutlineProvider();
  // Create TestRunner
  const testRunner = new ApexTestRunner(testOutlineProvider);

  // Test View
  const testViewItems = new Array<vscode.Disposable>();

  const testProvider = vscode.window.registerTreeDataProvider(
    'sfdx.test.view',
    testOutlineProvider
  );
  testViewItems.push(testProvider);

  // Run Test Button on Test View command
  testViewItems.push(
    vscode.commands.registerCommand('sfdx.test.view.run', () =>
      testRunner.runAllApexTests()
    )
  );
  // Show Error Message command
  testViewItems.push(
    vscode.commands.registerCommand('sfdx.test.view.showError', test =>
      testRunner.showErrorMessage(test)
    )
  );
  // Show Definition command
  testViewItems.push(
    vscode.commands.registerCommand('sfdx.test.view.goToDefinition', test =>
      testRunner.showErrorMessage(test)
    )
  );
  // Run Class Tests command
  testViewItems.push(
    vscode.commands.registerCommand('sfdx.test.view.runClassTests', test =>
      testRunner.runApexTests([test.name], TestRunType.Class)
    )
  );
  // Run Single Test command
  testViewItems.push(
    vscode.commands.registerCommand('sfdx.test.view.runSingleTest', test =>
      testRunner.runApexTests([test.name], TestRunType.Method)
    )
  );
  // Refresh Test View command
  testViewItems.push(
    vscode.commands.registerCommand('sfdx.test.view.refresh', () => {
      if (languageClientUtils.getStatus().isReady()) {
        return testOutlineProvider.refresh();
      }
    })
  );

  return vscode.Disposable.from(...testViewItems);
};

export const deactivate = async () => {
  await languageClientUtils.getClientInstance()?.stop();
  telemetryService.sendExtensionDeactivationEvent();
};

const createLanguageClient = async (
  extensionContext: vscode.ExtensionContext,
  languageServerStatusBarItem: ApexLSPStatusBarItem
): Promise<void> => {
  // Resolve any found orphan language servers
  void lsoh.resolveAnyFoundOrphanLanguageServers();
  // Initialize Apex language server
  try {
    const langClientHRStart = process.hrtime();
    languageClientUtils.setClientInstance(
      await languageServer.createLanguageServer(extensionContext)
    );

    const languageClient = languageClientUtils.getClientInstance();

    if (languageClient) {
      languageClient.errorHandler?.addListener('error', message => {
        languageServerStatusBarItem.error(message);
      });
      languageClient.errorHandler?.addListener('restarting', count => {
        languageServerStatusBarItem.error(
          nls
            .localize('apex_language_server_quit_and_restarting')
            .replace('$N', count)
        );
      });
      languageClient.errorHandler?.addListener('startFailed', () => {
        languageServerStatusBarItem.error(
          nls.localize('apex_language_server_failed_activate')
        );
      });

      // TODO: the client should not be undefined. We should refactor the code to
      // so there is no question as to whether the client is defined or not.
      await languageClient.start();
      // Client is running
      const startTime = telemetryService.getEndHRTime(langClientHRStart); // Record the end time
      telemetryService.sendEventData('apexLSPStartup', undefined, {
        activationTime: startTime
      });
      await indexerDoneHandler(
        retrieveEnableSyncInitJobs(),
        languageClient,
        languageServerStatusBarItem
      );
      extensionContext.subscriptions.push(
        languageClientUtils.getClientInstance()!
      );
    } else {
      languageClientUtils.setStatus(
        ClientStatus.Error,
        `${nls.localize(
          'apex_language_server_failed_activate'
        )} - ${nls.localize('unknown')}`
      );
      languageServerStatusBarItem.error(
        `${nls.localize(
          'apex_language_server_failed_activate'
        )} - ${nls.localize('unknown')}`
      );
    }
  } catch (e) {
    languageClientUtils.setStatus(ClientStatus.Error, e);
    let eMsg =
      typeof e === 'string' ? e : e.message ?? nls.localize('unknown_error');
    if (
      eMsg.includes(nls.localize('wrong_java_version_text', SET_JAVA_DOC_LINK))
    ) {
      eMsg = nls.localize('wrong_java_version_short');
    }
    languageServerStatusBarItem.error(
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      `${nls.localize('apex_language_server_failed_activate')} - ${eMsg}`
    );
  }
};

// exported only for test
export const indexerDoneHandler = async (
  enableSyncInitJobs: boolean,
  languageClient: ApexLanguageClient,
  languageServerStatusBarItem: ApexLSPStatusBarItem
) => {
  // Listener is useful only in async mode
  if (!enableSyncInitJobs) {
    // The listener should be set after languageClient is ready
    // Language client will get notified once async init jobs are done
    languageClientUtils.setStatus(ClientStatus.Indexing, '');
    languageClient.onNotification(API.doneIndexing, () => {
      void extensionUtils.setClientReady(
        languageClient,
        languageServerStatusBarItem
      );
    });
  } else {
    // indexer must be running at the point
    await extensionUtils.setClientReady(
      languageClient,
      languageServerStatusBarItem
    );
  }
};
