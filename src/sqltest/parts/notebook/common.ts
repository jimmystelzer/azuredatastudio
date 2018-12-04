/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { nb, IConnectionProfile } from 'sqlops';

import { Event, Emitter } from 'vs/base/common/event';
import { INotebookModel, ICellModel, IClientSession, IDefaultConnection } from 'sql/parts/notebook/models/modelInterfaces';
import { NotebookChangeType, CellType } from 'sql/parts/notebook/models/contracts';
import { INotebookManager } from 'sql/services/notebook/notebookService';

export class NotebookModelStub implements INotebookModel {
    constructor(private _languageInfo?: nb.ILanguageInfo) {
    }
    public trustedMode: boolean;

    public get languageInfo(): nb.ILanguageInfo {
        return this._languageInfo;
    }
    onCellChange(cell: ICellModel, change: NotebookChangeType): void {
        // Default: do nothing
    }
    get cells(): ReadonlyArray<ICellModel> {
        throw new Error('method not implemented.');
    }
    get clientSession(): IClientSession {
        throw new Error('method not implemented.');
    }
    get notebookManager(): INotebookManager {
        throw new Error('method not implemented.');
    }
    get kernelChanged(): Event<nb.IKernelChangedArgs> {
        throw new Error('method not implemented.');
    }
    get kernelsChanged(): Event<nb.IKernelSpec> {
        throw new Error('method not implemented.');
    }    get defaultKernel(): nb.IKernelSpec {
        throw new Error('method not implemented.');
    }
    get contextsChanged(): Event<void> {
        throw new Error('method not implemented.');
    }
    get specs(): nb.IAllKernels {
        throw new Error('method not implemented.');
    }
    get contexts(): IDefaultConnection {
        throw new Error('method not implemented.');
    }
    changeKernel(displayName: string): void {
        throw new Error('Method not implemented.');
    }
    changeContext(host: string, connection?: IConnectionProfile): void {
        throw new Error('Method not implemented.');
    }
    findCellIndex(cellModel: ICellModel): number {
        throw new Error('Method not implemented.');
    }
    addCell(cellType: CellType, index?: number): void {
        throw new Error('Method not implemented.');
    }
    deleteCell(cellModel: ICellModel): void {
        throw new Error('Method not implemented.');
    }
    saveModel(): Promise<boolean> {
        throw new Error('Method not implemented.');
    }
}

export class NotebookManagerStub implements INotebookManager {
    providerId: string;
    contentManager: nb.ContentManager;
    sessionManager: nb.SessionManager;
    serverManager: nb.ServerManager;
}

export class ServerManagerStub implements nb.ServerManager {
    public onServerStartedEmitter = new Emitter<void>();
    onServerStarted: Event<void> = this.onServerStartedEmitter.event;
    isStarted: boolean = false;
    calledStart: boolean = false;
    calledEnd: boolean = false;
    public result: Promise<void> = undefined;

    startServer(): Promise<void> {
        this.calledStart = true;
        return this.result;
    }
    stopServer(): Promise<void> {
        this.calledEnd = true;
        return this.result;
    }
}