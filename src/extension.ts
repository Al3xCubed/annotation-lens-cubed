import * as VSCODE from "vscode";

class Annotation {
	public constructor(
		public readonly sourceClassMemberSymbol: VSCODE.SymbolInformation & VSCODE.DocumentSymbol,
		public readonly superClassSymbol: VSCODE.SymbolInformation & VSCODE.DocumentSymbol,
		public readonly superClassMemberSymbol: VSCODE.SymbolInformation & VSCODE.DocumentSymbol,
		public readonly type: EAnnotationType,
	) {}
}

class AnnotationLens extends VSCODE.CodeLens {
	public constructor(annotation: Annotation) {
		super(annotation.sourceClassMemberSymbol.location.range, {
			command: "editor.action.peekLocations",
			title: `@${annotation.type} ${annotation.superClassSymbol.name}`,
			arguments: [
				annotation.sourceClassMemberSymbol.location.uri,
				annotation.sourceClassMemberSymbol.location.range.start,
				[annotation.superClassMemberSymbol.location],
				"peek",
			] as [VSCODE.Uri, VSCODE.Position, VSCODE.Location[], "peek" | "gotoAndPeek" | "goto"], // type check
		});
	}
}

enum EAnnotationType {
	Override = "Override",
	Implement = "Implement",
}

class Cache {
	private values: { [key: string]: SymbolInfo };

	public constructor() {
		this.values = {};
	}

	private static createKey(symbol: VSCODE.SymbolInformation & VSCODE.DocumentSymbol) {
		return `${symbol.name} ${symbol.kind} ${symbol.location.uri.toString()} ${
			symbol.location.range.start.character
		}@${symbol.location.range.start.line}...${symbol.location.range.end.character}@${
			symbol.location.range.end.line
		}`;
	}

	public clear() {
		this.values = {};
	}

	public has(symbol: VSCODE.SymbolInformation & VSCODE.DocumentSymbol) {
		return Cache.createKey(symbol) in this.values;
	}

	public get(symbol: VSCODE.SymbolInformation & VSCODE.DocumentSymbol) {
		return this.values[Cache.createKey(symbol)];
	}

	public add(value: SymbolInfo) {
		this.values[Cache.createKey(value.symbol)] = value;
	}
}

class SymbolInfo {
	public static readonly CACHE = new Cache();

	public readonly symbol: VSCODE.SymbolInformation & VSCODE.DocumentSymbol;
	public readonly superClasses: SymbolInfo[];
	public readonly superInterfaces: SymbolInfo[];

	public static async create(
		symbol: VSCODE.SymbolInformation & VSCODE.DocumentSymbol,
	): Promise<SymbolInfo> {
		if (SymbolInfo.CACHE.has(symbol)) return SymbolInfo.CACHE.get(symbol)!;

		const superClassesSymbols = await SymbolInfo.getSuperClasses(symbol);
		const superClasses = await Promise.all(
			superClassesSymbols.map((superClassSymbol) => SymbolInfo.create(superClassSymbol)),
		);
		const superInterfacesSymbols = await SymbolInfo.getSuperInterfaces(symbol);
		const superInterfaces = await Promise.all(
			superInterfacesSymbols.map((superInterfaceSymbol) =>
				SymbolInfo.create(superInterfaceSymbol),
			),
		);
		const createdSymbolInfo = new SymbolInfo(symbol, superClasses, superInterfaces);
		SymbolInfo.CACHE.add(createdSymbolInfo);
		return createdSymbolInfo;
	}

	private static async getSuperClasses(
		classOrInterface: VSCODE.SymbolInformation & VSCODE.DocumentSymbol,
	) {
		const document = await VSCODE.workspace.openTextDocument(classOrInterface.location.uri);
		const text = document.getText(classOrInterface.location.range);
		let index = 0;
		let depth = 0;
		while (true) {
			if (index >= text.length) return [];

			if (text[index] === "<") depth++;
			else if (text[index] === ">") depth--;
			else if (depth === 0 && text[index] === "{") return [];

			if (depth === 0 && text.substr(index).startsWith("extends ")) {
				index += "extends ".length;
				return await this.getDefinitionsAt(
					document.uri,
					new VSCODE.Position(classOrInterface.location.range.start.line, index),
				);
			}
			index++;
		}
	}

	private static async getSuperInterfaces(
		classOrInterface: VSCODE.SymbolInformation & VSCODE.DocumentSymbol,
	) {
		const document = await VSCODE.workspace.openTextDocument(classOrInterface.location.uri);
		const text = document.getText(classOrInterface.location.range);
		const superInterfaces: (VSCODE.SymbolInformation & VSCODE.DocumentSymbol)[] = [];
		let index = 0;
		let depth = 0;
		let inImplementList = false;
		let willFindSymbol = false;
		while (true) {
			if (index >= text.length) break;

			if (text[index] === "<") depth++;
			else if (text[index] === ">") depth--;
			else if (depth === 0) {
				if (text[index] === "{") break;

				if (text.substr(index).startsWith("implements ")) {
					inImplementList = true;
					willFindSymbol = true;
					index += "implements ".length;
				}

				if (inImplementList && text[index] === ",") willFindSymbol = true;

				if (willFindSymbol) {
					if (/[A-z_]/.test(text[index]!)) {
						const superSuperInterfaces = await SymbolInfo.getDefinitionsAt(
							document.uri,
							new VSCODE.Position(classOrInterface.location.range.start.line, index),
						);
						if (superSuperInterfaces != undefined)
							superInterfaces.push(...superSuperInterfaces);
						willFindSymbol = false;
					}
				}
			}

			index++;
		}

		return superInterfaces;
	}

	private static async getSymbol(locationLink: VSCODE.LocationLink) {
		const documentSymbols = (await VSCODE.commands.executeCommand<
			(VSCODE.SymbolInformation & VSCODE.DocumentSymbol)[]
		>("vscode.executeDocumentSymbolProvider", locationLink.targetUri))!;
		return documentSymbols.find((documentSymbol) =>
			documentSymbol.range.isEqual(locationLink.targetRange),
		);
	}

	private static async getDefinitionsAt(document: VSCODE.Uri, position: VSCODE.Position) {
		const definitionLinks = await VSCODE.commands.executeCommand<VSCODE.LocationLink[]>(
			"vscode.executeDefinitionProvider",
			document,
			position,
		);
		if (definitionLinks == undefined) return [];

		const definitions = (
			await Promise.all(
				definitionLinks.map((definitionLink) => SymbolInfo.getSymbol(definitionLink)),
			)
		).filter((definition) => definition != undefined);
		return definitions as (VSCODE.SymbolInformation & VSCODE.DocumentSymbol)[];
	}

	private constructor(
		symbol: VSCODE.SymbolInformation & VSCODE.DocumentSymbol,
		superClasses: SymbolInfo[] = [],
		superInterfaces: SymbolInfo[] = [],
	) {
		this.symbol = symbol;
		this.superClasses = superClasses;
		this.superInterfaces = superInterfaces;

		if (
			this.symbol.kind !== VSCODE.SymbolKind.Class &&
			this.symbol.kind !== VSCODE.SymbolKind.Interface
		) {
			throw new Error("Expected class or interface");
		}
	}

	public get members() {
		return this.symbol.children as (VSCODE.SymbolInformation & VSCODE.DocumentSymbol)[];
	}

	public get isInterface() {
		return this.symbol.kind === VSCODE.SymbolKind.Interface;
	}

	public get isClass() {
		return this.symbol.kind === VSCODE.SymbolKind.Class;
	}

	private async getAnnotationType(memberSymbol: VSCODE.SymbolInformation) {
		if (this.isInterface) return EAnnotationType.Implement;

		const document = await VSCODE.workspace.openTextDocument(memberSymbol.location.uri);
		const text = document.getText(memberSymbol.location.range);
		if (text.includes("abstract ")) return EAnnotationType.Implement;
		else return EAnnotationType.Override;
	}

	public async getAnnotations(source?: SymbolInfo) {
		const annotations: Annotation[] = [];

		if (source != undefined) {
			const sourceMembers = source.members;
			for (const thisMember of this.members) {
				const sourceMember = sourceMembers.find(
					(sourceMember) => sourceMember.name === thisMember.name,
				);
				if (sourceMember != undefined) {
					annotations.push(
						new Annotation(
							sourceMember,
							this.symbol,
							thisMember,
							source.isInterface
								? EAnnotationType.Override
								: await this.getAnnotationType(thisMember),
						),
					);
				}
			}
		}

		for (const superClass of this.superClasses)
			annotations.push(...(await superClass.getAnnotations(source ?? this)));
		for (const superInterface of this.superInterfaces)
			annotations.push(...(await superInterface.getAnnotations(source ?? this)));
		return annotations;
	}
}

class AnnotationLensProvider implements VSCODE.CodeLensProvider<AnnotationLens> {
	public async provideCodeLenses(document: VSCODE.TextDocument): Promise<VSCODE.CodeLens[]> {
		const classesAndInterfaces = await this.getDocumentClassesAndInterfaces(document);

		const results: AnnotationLens[] = [];
		SymbolInfo.CACHE.clear();

		for (const classOrInterface of classesAndInterfaces) {
			const symbolInfo = await SymbolInfo.create(classOrInterface);
			const annotations = await symbolInfo.getAnnotations();
			results.push(...annotations.map((annotation) => new AnnotationLens(annotation)));
		}

		return results;
	}

	private async getDocumentClassesAndInterfaces(document: VSCODE.TextDocument) {
		const symbols = (await VSCODE.commands.executeCommand<
			(VSCODE.SymbolInformation & VSCODE.DocumentSymbol)[]
		>("vscode.executeDocumentSymbolProvider", document.uri))!.filter(
			(symbol) =>
				symbol.kind === VSCODE.SymbolKind.Class ||
				symbol.kind === VSCODE.SymbolKind.Interface,
		);
		return symbols;
	}
}

export function activate(context: VSCODE.ExtensionContext) {
	context.subscriptions.push(
		VSCODE.languages.registerCodeLensProvider(
			[{ language: "typescript" }, { language: "javascript" }],
			new AnnotationLensProvider(),
		),
	);
}
