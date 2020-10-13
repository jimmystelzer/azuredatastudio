/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as loc from '../../localizedConstants';
import { INotebookService, Notebook } from '../../services/notebookService';
import { IToolsService } from '../../services/toolsService';
import { Model } from '../model';
import { InputComponents, setModelValues } from '../modelViewUtils';
import { WizardBase } from '../wizardBase';
import { DeploymentProviderBase, DeploymentType, instanceOfNotebookWizardDeploymentProvider, NotebookWizardInfo, ResourceType } from './../../interfaces';
import { IPlatformService } from './../../services/platformService';
import { NotebookWizardAutoSummaryPage } from './notebookWizardAutoSummaryPage';
import { NotebookWizardPage } from './notebookWizardPage';
import { NotebookWizardToolsAndEulaPage } from './notebookWizardToolsAndEulaPage';

export class NotebookWizard extends WizardBase<NotebookWizard, NotebookWizardPage, Model> {
	private _inputComponents: InputComponents = {};
	private _resourceProvider!: DeploymentProviderBase;

	public get notebookService(): INotebookService {
		return this._notebookService;
	}

	public get platformService(): IPlatformService {
		return this._platformService;
	}

	public get wizardInfo(): NotebookWizardInfo {
		return this._wizardInfo;
	}

	public get inputComponents(): InputComponents {
		return this._inputComponents;
	}

	public get resourceType(): ResourceType {
		return this._resourceType!;
	}

	public set resourceProvider(provider: DeploymentProviderBase) {
		this._resourceProvider = provider;
	}

	public get resourceProvider(): DeploymentProviderBase {
		return this._resourceProvider;
	}

	constructor(private _wizardInfo: NotebookWizardInfo, private _notebookService: INotebookService, private _platformService: IPlatformService, toolsService: IToolsService, private _resourceType?: ResourceType) {
		super(_wizardInfo.title, _wizardInfo.name || '', new Model(), toolsService);
		if (this._wizardInfo.codeCellInsertionPosition === undefined) {
			this._wizardInfo.codeCellInsertionPosition = 0;
		}
		this.wizardObject.doneButton.label = _wizardInfo.doneAction?.label || loc.deployNotebook;
		this.wizardObject.generateScriptButton.label = _wizardInfo.scriptAction?.label || loc.scriptToNotebook;

		//Setting the first provider as the default initially.
		if (this.resourceType) {
			this._resourceProvider = this.resourceType.providers[0];
		}
	}

	public get deploymentType(): DeploymentType | undefined {
		return this._wizardInfo.type;
	}

	protected initialize(): void {
		this.setPages(this.getPages());
	}

	protected onCancel(): void {
	}

	protected async onGenerateScript(): Promise<void> {
		try {
			const notebook = await this.prepareNotebookAndEnvironment();
			await this.openNotebook(notebook);
		} catch (error) {
			vscode.window.showErrorMessage(error);
		}
	}
	protected async onOk(): Promise<void> {
		try {
			const notebook = await this.prepareNotebookAndEnvironment();
			const openedNotebook = await this.openNotebook(notebook);
			openedNotebook.runAllCells();
		} catch (error) {
			vscode.window.showErrorMessage(error);
		}
	}

	private async openNotebook(notebook: Notebook) {
		const notebookPath = this.notebookService.getNotebookPath(this.wizardInfo.notebook);
		return await this.notebookService.openNotebookWithContent(notebookPath, JSON.stringify(notebook, undefined, 4));
	}

	private async prepareNotebookAndEnvironment() {
		await setModelValues(this.inputComponents, this.model);
		const env: NodeJS.ProcessEnv = process.env;
		this.model.setEnvironmentVariables(env, (varName) => {
			const isPassword = !!this.inputComponents[varName]?.isPassword;
			return isPassword;
		});
		const notebook: Notebook = await this.notebookService.getNotebook(this.wizardInfo.notebook);
		// generate python code statements for all variables captured by the wizard
		const statements = this.model.getCodeCellContentForNotebook(
			this.toolsService.toolsForCurrentProvider,
			(varName) => {
				const isPassword = !!this.inputComponents[varName]?.isPassword;
				return !isPassword;
			}
		);
		// insert generated code statements into the notebook.
		notebook.cells.splice(
			this.wizardInfo.codeCellInsertionPosition ?? 0,
			0,
			{
				cell_type: 'code',
				source: statements,
				metadata: {},
				outputs: [],
				execution_count: 0
			}
		);
		return notebook;
	}

	private getPages(): NotebookWizardPage[] {
		const pages: NotebookWizardPage[] = [];
		pages.push(new NotebookWizardToolsAndEulaPage(this, 0));
		for (let pageIndex: number = 0; pageIndex < this.wizardInfo.pages.length; pageIndex++) {
			if (this.wizardInfo.pages[pageIndex].isSummaryPage && this.wizardInfo.isSummaryPageAutoGenerated) {
				// If we are auto-generating the summary page
				pages.push(new NotebookWizardAutoSummaryPage(this, pageIndex));
			} else {
				pages.push(new NotebookWizardPage(this, pageIndex));
			}
		}
		return pages;
	}

	public async refreshPage() {
		// All the providers will be handled differently

		if (instanceOfNotebookWizardDeploymentProvider(this._resourceProvider)) {
			this._wizardInfo = this._resourceProvider.notebookWizard!;
		} else {
			return;
		}

		const currentPageNumber = this.wizardObject.pages.length;

		for (let i = 1; i < currentPageNumber; i++) {
			this.wizardObject.removePage(this.wizardObject.pages.length - 1);
		}

		const newPages = this.getPages();

		newPages[0] = this.pages[0];

		this.pages = newPages;

		for (let i = 1; i < newPages.length; i++) {
			newPages[i].pageObject.onValidityChanged((isValid: boolean) => {
				// generateScriptButton is enabled only when the page is valid.
				this.wizardObject.generateScriptButton.enabled = isValid;
			});
			newPages[i].initialize();
			this.wizardObject.addPage(newPages[i].pageObject);
		}

		//this.setPages(this.getPages());

		// await this.wizardObject.close();
		// await this.wizardObject.open();
	}
}
