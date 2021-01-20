/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as azdata from 'azdata';
import * as azdataExt from 'azdata-ext';
import * as loc from '../../../localizedConstants';
import { UserCancelledError } from '../../../common/api';
import { IconPathHelper, cssStyles } from '../../../constants';
import { DashboardPage } from '../../components/dashboardPage';
import { EngineSettingsModel, PostgresModel } from '../../../models/postgresModel';

export type ParametersModel = {
	parameterName: string,
	valueContainer: azdata.FlexContainer,
	description: string,
	resetButton: azdata.ButtonComponent
};

export class PostgresParametersPage extends DashboardPage {
	private searchBox!: azdata.InputBoxComponent;
	private parametersTable!: azdata.DeclarativeTableComponent;
	private parameterContainer?: azdata.DivContainer;
	private _parametersTableLoading!: azdata.LoadingComponent;

	private discardButton!: azdata.ButtonComponent;
	private saveButton!: azdata.ButtonComponent;
	private resetAllButton!: azdata.ButtonComponent;
	private connectToServerButton?: azdata.ButtonComponent;

	private _parameters: ParametersModel[] = [];
	private parameterUpdates: Map<string, string> = new Map();

	private readonly _azdataApi: azdataExt.IExtension;

	constructor(protected modelView: azdata.ModelView, private _postgresModel: PostgresModel) {
		super(modelView);
		this._azdataApi = vscode.extensions.getExtension(azdataExt.extension.name)?.exports;

		this.initializeConnectButton();
		this.initializeSearchBox();

		this.disposables.push(
			this._postgresModel.onConfigUpdated(() => this.eventuallyRunOnInitialized(() => this.handleServiceUpdated())),
			this._postgresModel.onEngineSettingsUpdated(() => this.eventuallyRunOnInitialized(() => this.refreshParametersTable()))
		);
	}

	protected get title(): string {
		return loc.nodeParameters;
	}

	protected get id(): string {
		return 'postgres-node-parameters';
	}

	protected get icon(): { dark: string; light: string; } {
		return IconPathHelper.gear;
	}

	protected get container(): azdata.Component {
		const root = this.modelView.modelBuilder.divContainer().component();
		const content = this.modelView.modelBuilder.divContainer().component();
		root.addItem(content, { CSSStyles: { 'margin': '20px' } });

		content.addItem(this.modelView.modelBuilder.text().withProps({
			value: loc.nodeParameters,
			CSSStyles: { ...cssStyles.title }
		}).component());

		const info = this.modelView.modelBuilder.text().withProps({
			value: loc.nodeParametersDescription,
			CSSStyles: { ...cssStyles.text, 'margin-block-start': '0px', 'margin-block-end': '0px' }
		}).component();

		const link = this.modelView.modelBuilder.hyperlink().withProps({
			label: loc.learnAboutNodeParameters,
			url: 'https://docs.microsoft.com/azure/azure-arc/data/configure-server-parameters-postgresql-hyperscale',
		}).component();

		const infoAndLink = this.modelView.modelBuilder.flexContainer().withLayout({ flexWrap: 'wrap' }).component();
		infoAndLink.addItem(info, { CSSStyles: { 'margin-right': '5px' } });
		infoAndLink.addItem(link);
		content.addItem(infoAndLink, { CSSStyles: { 'margin-bottom': '20px' } });

		content.addItem(this.searchBox!, { CSSStyles: { ...cssStyles.text, 'margin-block-start': '0px', 'margin-block-end': '0px', 'margin-bottom': '20px' } });

		this.parametersTable = this.modelView.modelBuilder.declarativeTable().withProps({
			width: '100%',
			columns: [
				{
					displayName: loc.parameterName,
					valueType: azdata.DeclarativeDataType.string,
					isReadOnly: true,
					width: '20%',
					headerCssStyles: cssStyles.tableHeader,
					rowCssStyles: cssStyles.tableRow
				},
				{
					displayName: loc.value,
					valueType: azdata.DeclarativeDataType.component,
					isReadOnly: false,
					width: '20%',
					headerCssStyles: cssStyles.tableHeader,
					rowCssStyles: cssStyles.tableRow
				},
				{
					displayName: loc.description,
					valueType: azdata.DeclarativeDataType.string,
					isReadOnly: true,
					width: '50%',
					headerCssStyles: cssStyles.tableHeader,
					rowCssStyles: {
						...cssStyles.tableRow,
						'overflow': 'hidden',
						'text-overflow': 'ellipsis',
						'white-space': 'nowrap',
						'max-width': '0'
					}
				},
				{
					displayName: loc.resetToDefault,
					valueType: azdata.DeclarativeDataType.component,
					isReadOnly: false,
					width: '10%',
					headerCssStyles: cssStyles.tableHeader,
					rowCssStyles: cssStyles.tableRow
				}
			],
			data: []
		}).component();

		this._parametersTableLoading = this.modelView.modelBuilder.loadingComponent().component();

		this.parameterContainer = this.modelView.modelBuilder.divContainer().component();
		this.selectComponent();

		content.addItem(this.parameterContainer);

		this.initialized = true;

		return root;
	}

	protected get toolbarContainer(): azdata.ToolbarContainer {
		// Save Edits
		this.saveButton = this.modelView.modelBuilder.button().withProps({
			label: loc.saveText,
			iconPath: IconPathHelper.save,
			enabled: false
		}).component();

		let engineSettings: string[] = [];
		this.disposables.push(
			this.saveButton.onDidClick(async () => {
				this.saveButton!.enabled = false;
				try {
					await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: loc.updatingInstance(this._postgresModel.info.name),
							cancellable: false
						},
						async (_progress, _token): Promise<void> => {
							try {
								this.parameterUpdates!.forEach((value, key) => {
									engineSettings.push(`${key}=${value}`);
								});
								await this._azdataApi.azdata.arc.postgres.server.edit(
									this._postgresModel.info.name,
									{ engineSettings: engineSettings.toString() },
									this._postgresModel.engineVersion);
							} catch (err) {
								// If an error occurs while editing the instance then re-enable the save button since
								// the edit wasn't successfully applied
								this.saveButton!.enabled = true;
								throw err;
							}
							await this._postgresModel.refresh();
							await this.callGetEngineSettings();
						}
					);

					vscode.window.showInformationMessage(loc.instanceUpdated(this._postgresModel.info.name));

					engineSettings = [];
					this.parameterUpdates!.clear();
					this.discardButton!.enabled = false;
					this.resetAllButton!.enabled = true;

				} catch (error) {
					vscode.window.showErrorMessage(loc.instanceUpdateFailed(this._postgresModel.info.name, error));
				}
			})
		);

		// Discard
		this.discardButton = this.modelView.modelBuilder.button().withProps({
			label: loc.discardText,
			iconPath: IconPathHelper.discard,
			enabled: false
		}).component();

		this.disposables.push(
			this.discardButton.onDidClick(async () => {
				this.discardButton!.enabled = false;
				try {
					this.refreshParametersTable();
				} catch (error) {
					vscode.window.showErrorMessage(loc.pageDiscardFailed(error));
				} finally {
					this.saveButton!.enabled = false;
				}
			})
		);

		// Reset all
		this.resetAllButton = this.modelView.modelBuilder.button().withProps({
			label: loc.resetAllToDefault,
			iconPath: IconPathHelper.reset,
			enabled: false
		}).component();

		this.disposables.push(
			this.resetAllButton.onDidClick(async () => {
				this.resetAllButton!.enabled = false;
				this.discardButton!.enabled = false;
				this.saveButton!.enabled = false;
				try {
					await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: loc.updatingInstance(this._postgresModel.info.name),
							cancellable: false
						},
						async (_progress, _token): Promise<void> => {
							try {
								await this._azdataApi.azdata.arc.postgres.server.edit(
									this._postgresModel.info.name,
									{ engineSettings: `''`, replaceEngineSettings: true },
									this._postgresModel.engineVersion);
							} catch (err) {
								// If an error occurs while resetting the instance then re-enable the reset button since
								// the edit wasn't successfully applied
								if (this.parameterUpdates.size > 0) {
									this.discardButton!.enabled = true;
									this.saveButton!.enabled = true;
								}
								this.resetAllButton!.enabled = true;
								throw err;
							}
							await this._postgresModel.refresh();
							await this.callGetEngineSettings();
						}

					);
					this.parameterUpdates!.clear();

				} catch (error) {
					vscode.window.showErrorMessage(loc.resetFailed(error));
				}
			})
		);

		return this.modelView.modelBuilder.toolbarContainer().withToolbarItems([
			{ component: this.saveButton },
			{ component: this.discardButton },
			{ component: this.resetAllButton }
		]).component();
	}

	private initializeConnectButton(): void {
		this.connectToServerButton = this.modelView.modelBuilder.button().withProps({
			label: loc.connectToServer,
			enabled: false,
			CSSStyles: { 'max-width': '125px' }
		}).component();

		this.disposables.push(
			this.connectToServerButton!.onDidClick(async () => {
				this.connectToServerButton!.enabled = false;
				if (!vscode.extensions.getExtension(loc.postgresExtension)) {
					const response = await vscode.window.showErrorMessage(loc.missingExtension('PostgreSQL'), loc.yes, loc.no);
					if (response !== loc.yes) {
						this.connectToServerButton!.enabled = true;
						return;
					}

					this._parametersTableLoading!.loading = true;
					await vscode.commands.executeCommand('workbench.extensions.installExtension', loc.postgresExtension);
				}

				this._parametersTableLoading!.loading = true;
				await this.callGetEngineSettings().finally(() => this._parametersTableLoading!.loading = false);
				this.searchBox!.enabled = true;
				this.resetAllButton!.enabled = true;
				this.parameterContainer!.clearItems();
				this.parameterContainer!.addItem(this.parametersTable);
			})
		);
	}

	private initializeSearchBox(): void {
		this.searchBox = this.modelView.modelBuilder.inputBox().withProps({
			readOnly: false,
			enabled: false,
			placeHolder: loc.searchToFilter
		}).component();

		this.disposables.push(
			this.searchBox.onTextChanged(() => {
				if (!this.searchBox!.value) {
					this.parametersTable.data = this._parameters.map(p => [p.parameterName, p.valueContainer, p.description, p.resetButton]);
				} else {
					this.filterParameters(this.searchBox!.value);
				}
			})
		);
	}

	private filterParameters(search: string): void {
		let filterData: ParametersModel[] = [];

		this._parameters.forEach(param => {
			if (param.parameterName?.search(search) !== -1 || param.description?.search(search) !== -1) {
				filterData.push(param);
			}
		});

		this.parametersTable.data = filterData.map(f => [f.parameterName, f.valueContainer, f.description, f.resetButton]);
	}

	private createParameters(): void {
		this._parameters = [];
		this._postgresModel._engineSettings.forEach(engineSetting => {
			this._parameters.push(this.createParameterComponents(engineSetting));
		});
	}

	private handleOnTextChanged(component: azdata.InputBoxComponent, currentValue: string | undefined): boolean {
		if (!component.valid) {
			// If invalid value retun false and enable discard button
			this.discardButton!.enabled = true;
			return false;
		} else if (component.value === currentValue) {
			return false;
		} else {
			/* If a valid value has been entered into the input box, enable save and discard buttons
			so that user could choose to either edit instance or clear all inputs
			return true */
			this.saveButton!.enabled = true;
			this.discardButton!.enabled = true;
			return true;
		}

	}

	private createParameterComponents(engineSetting: EngineSettingsModel): ParametersModel {

		// Container to hold input component and information bubble
		const valueContainer = this.modelView.modelBuilder.flexContainer().withLayout({ alignItems: 'center' }).component();

		// Information bubble title to be set depening on type of input
		let information = this.modelView.modelBuilder.button().withProps({
			iconPath: IconPathHelper.information,
			width: '12px',
			height: '12px',
			enabled: false
		}).component();

		if (engineSetting.type === 'enum') {
			// If type is enum, component should be drop down menu
			let options = engineSetting.options?.slice(1, -1).split(',');
			let values: string[] = [];
			options!.forEach(option => {
				values.push(option.slice(option.indexOf('"') + 1, -1));
			});

			let valueBox = this.modelView.modelBuilder.dropDown().withProps({
				values: values,
				value: engineSetting.value,
				CSSStyles: { ...cssStyles.text, 'margin-block-start': '0px', 'margin-block-end': '0px' }
			}).component();
			valueContainer.addItem(valueBox, { CSSStyles: { 'margin-right': '0px' } });

			this.disposables.push(
				valueBox.onValueChanged(() => {
					if (engineSetting.value !== String(valueBox.value)) {
						this.parameterUpdates!.set(engineSetting.parameterName!, String(valueBox.value));
						this.saveButton!.enabled = true;
						this.discardButton!.enabled = true;
					} else if (this.parameterUpdates!.has(engineSetting.parameterName!)) {
						this.parameterUpdates!.delete(engineSetting.parameterName!);
					}
				})
			);

			information.updateProperty('title', loc.allowedValue(engineSetting.options!));
			valueContainer.addItem(information, { CSSStyles: { 'margin-left': '5px' } });
		} else if (engineSetting.type === 'bool') {
			// If type is bool, component should be checkbox to turn on or off
			let valueBox = this.modelView.modelBuilder.checkBox().withProps({
				label: loc.on,
				CSSStyles: { ...cssStyles.text, 'margin-block-start': '0px', 'margin-block-end': '0px' }
			}).component();
			valueContainer.addItem(valueBox, { CSSStyles: { 'margin-right': '0px' } });
			if (engineSetting.value === 'on') {
				valueBox.checked = true;
			} else {
				valueBox.checked = false;
			}

			this.disposables.push(
				valueBox.onChanged(() => {
					if (valueBox.checked && engineSetting.value === 'off') {
						this.parameterUpdates!.set(engineSetting.parameterName!, loc.on);
						this.saveButton!.enabled = true;
						this.discardButton!.enabled = true;
					} else if (!valueBox.checked && engineSetting.value === 'on') {
						this.parameterUpdates!.set(engineSetting.parameterName!, loc.off);
						this.saveButton!.enabled = true;
						this.discardButton!.enabled = true;
					} else if (this.parameterUpdates!.has(engineSetting.parameterName!)) {
						this.parameterUpdates!.delete(engineSetting.parameterName!);
					}
				})
			);

			information.updateProperty('title', loc.allowedValue(`${loc.on},${loc.off}`));
			valueContainer.addItem(information, { CSSStyles: { 'margin-left': '5px' } });
		} else if (engineSetting.type === 'string') {
			// If type is string, component should be text inputbox
			let valueBox = this.modelView.modelBuilder.inputBox().withProps({
				required: true,
				readOnly: false,
				value: engineSetting.value,
				CSSStyles: { 'min-width': '50px', 'max-width': '200px' }
			}).component();
			valueContainer.addItem(valueBox, { CSSStyles: { 'margin-right': '0px' } });

			this.disposables.push(
				valueBox.onTextChanged(() => {
					if ((this.handleOnTextChanged(valueBox, engineSetting.value))) {
						this.parameterUpdates!.set(engineSetting.parameterName!, `"${valueBox.value!}"`);
					} else if (this.parameterUpdates!.has(engineSetting.parameterName!)) {
						this.parameterUpdates!.delete(engineSetting.parameterName!);
					}
				})
			);
		} else {
			// If type is real or interger, component should be inputbox set to inputType of number. Max and min values also set.
			let valueBox = this.modelView.modelBuilder.inputBox().withProps({
				required: true,
				readOnly: false,
				min: parseInt(engineSetting.min!),
				max: parseInt(engineSetting.max!),
				validationErrorMessage: loc.outOfRange(engineSetting.min!, engineSetting.max!),
				inputType: 'number',
				value: engineSetting.value,
				CSSStyles: { 'min-width': '50px', 'max-width': '200px' }
			}).component();
			valueContainer.addItem(valueBox, { CSSStyles: { 'margin-right': '0px' } });

			this.disposables.push(
				valueBox.onTextChanged(() => {
					if ((this.handleOnTextChanged(valueBox, engineSetting.value))) {
						this.parameterUpdates!.set(engineSetting.parameterName!, valueBox.value!);
					} else if (this.parameterUpdates!.has(engineSetting.parameterName!)) {
						this.parameterUpdates!.delete(engineSetting.parameterName!);
					}
				})
			);

			information.updateProperty('title', loc.allowedValue(loc.rangeSetting(engineSetting.min!, engineSetting.max!)));
			valueContainer.addItem(information, { CSSStyles: { 'margin-left': '5px' } });
		}

		// Can reset individual parameter
		const resetParameterButton = this.modelView.modelBuilder.button().withProps({
			iconPath: IconPathHelper.reset,
			title: loc.resetToDefault,
			width: '20px',
			height: '20px',
			enabled: true
		}).component();

		this.disposables.push(
			resetParameterButton.onDidClick(async () => {
				try {
					await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: loc.updatingInstance(this._postgresModel.info.name),
							cancellable: false
						},
						async (_progress, _token): Promise<void> => {
							try {
								await this._azdataApi.azdata.arc.postgres.server.edit(
									this._postgresModel.info.name,
									{ engineSettings: engineSetting.parameterName + '=' },
									this._postgresModel.engineVersion);
							} catch (err) {
								throw err;
							}
							await this._postgresModel.refresh();
							await this.callGetEngineSettings();
						}
					);

					vscode.window.showInformationMessage(loc.instanceUpdated(this._postgresModel.info.name));
				} catch (error) {
					vscode.window.showErrorMessage(loc.instanceUpdateFailed(this._postgresModel.info.name, error));
				}
			})
		);

		let parameter: ParametersModel = {
			parameterName: engineSetting.parameterName!,
			valueContainer: valueContainer,
			description: engineSetting.description!,
			resetButton: resetParameterButton
		};

		return parameter;
	}

	private selectComponent(): void {
		if (!this._postgresModel.engineSettingsLastUpdated) {
			this.parameterContainer!.addItem(this.modelView.modelBuilder.text().withProps({
				value: loc.connectToPostgresDescription,
				CSSStyles: { ...cssStyles.text, 'margin-block-start': '0px', 'margin-block-end': '0px' }
			}).component());
			this.parameterContainer!.addItem(this.connectToServerButton!, { CSSStyles: { 'max-width': '125px' } });
			this.parameterContainer!.addItem(this._parametersTableLoading!);
		} else {
			this.parameterContainer!.addItem(this.parametersTable!);
			this.refreshParametersTable();
		}
	}

	private async callGetEngineSettings(): Promise<void> {
		await this._postgresModel.getEngineSettings().catch(err => {
			// If an error occurs show a message so the user knows something failed but still
			// fire the event so callers can know to update (e.g. so dashboards don't show the
			// loading icon forever)
			if (err instanceof UserCancelledError) {
				vscode.window.showWarningMessage(loc.pgConnectionRequired);
			} else {
				vscode.window.showErrorMessage(loc.fetchEngineSettingsFailed(this._postgresModel.info.name, err));
			}
			this.connectToServerButton!.enabled = true;
			throw err;
		});
	}

	private refreshParametersTable(): void {
		this.createParameters();
		this.parametersTable.data = this._parameters.map(p => [p.parameterName, p.valueContainer, p.description, p.resetButton]);
	}

	private handleServiceUpdated(): void {
		if (this._postgresModel.configLastUpdated && !this._postgresModel.engineSettingsLastUpdated) {
			this.connectToServerButton!.enabled = true;
			this._parametersTableLoading!.loading = false;
		}
	}
}
