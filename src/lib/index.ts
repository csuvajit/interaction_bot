import {
	ClientEvents,
	Collection,
	CommandInteraction,
	CommandInteractionOption,
	Constants,
	GuildChannel,
	HexColorString,
	Interaction,
	PermissionString,
	Util
} from 'discord.js';
import EventEmitter from 'events';
import { extname } from 'path';
import { Client } from '../struct/Client';
import { container } from 'tsyringe';
import readdirp from 'readdirp';
import { pathToFileURL } from 'url';
import { BuiltInReasons, CommandHandlerEvents } from './util';

type ArgsMatchType =
	| 'SUB_COMMAND'
	| 'SUB_COMMAND_GROUP'
	| 'STRING'
	| 'INTEGER'
	| 'BOOLEAN'
	| 'USER'
	| 'MEMBER'
	| 'CHANNEL'
	| 'ROLE'
	| 'MENTIONABLE'
	| 'NUMBER'
	| 'COLOR';

export interface Args {
	[key: string]: {
		id?: string;
		match: ArgsMatchType;
	} | null;
}

export class BaseHandler extends EventEmitter {
	public readonly client: Client;
	public readonly directory: string;
	public readonly modules: Collection<string, Command | Listener | Inhibitor>;

	public constructor(client: Client, { directory }: { directory: string }) {
		super();

		this.client = client;
		this.directory = directory;
		this.modules = new Collection();
	}

	public async register() {
		for await (const dir of readdirp(this.directory, { fileFilter: '*.js' })) {
			if (extname(dir.path) !== '.js') continue;
			const mod = container.resolve<Command | Listener | Inhibitor>(
				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				(await import(pathToFileURL(dir.fullPath).href)).default
			);
			this.construct(mod);
		}
	}

	public construct(mod: Command | Listener | Inhibitor) {
		this.modules.set(mod.id, mod);
	}
}

export class CommandHandler extends BaseHandler {
	public override modules!: Collection<string, Command>;

	public constructor(public client: Client, { directory }: { directory: string }) {
		super(client, { directory });

		container.register(CommandHandler, { useValue: this });

		client.on(Constants.Events.INTERACTION_CREATE, (interaction: Interaction) => {
			if (!interaction.isCommand()) return;
			const command = this.modules.get('ping'); // this.modules.get(interaction.commandName);
			if (!command) return;
			return this.exec(interaction, command);
		});
	}

	public transformInteraction(
		options: readonly CommandInteractionOption[],
		result: { [key: string]: CommandInteractionOption } = {}
	): { [key: string]: CommandInteractionOption } {
		for (const option of options) {
			if (option.type === 'SUB_COMMAND' || option.type === 'SUB_COMMAND_GROUP') {
				result.command = option;
				return this.transformInteraction([...(option.options ?? [])], result);
			}
			result[option.name] = option;
		}

		return result;
	}

	public argumentRunner(interaction: CommandInteraction, command: Command) {
		const args = command.args();

		const resolved: { [key: string]: unknown } = {};
		for (const [name, option] of Object.entries(this.transformInteraction(interaction.options.data))) {
			const key = (args[name]?.id ?? name).toLowerCase(); // KEY_OVERRIDE

			if (['SUB_COMMAND', 'SUB_COMMAND_GROUP'].includes(option.type)) {
				resolved[key] = option.name; // SUB_COMMAND OR SUB_COMMAND_GROUP
			} else if (option.type === 'CHANNEL') {
				resolved[key] = (option.channel as GuildChannel | null)?.isText() ? option.channel : null;
			} else if (option.type === 'ROLE') {
				resolved[key] = option.role ?? null;
			} else if (option.type === 'USER') {
				resolved[key] = args[key]?.match === 'MEMBER' ? option.member ?? null : option.user ?? null;
			} else {
				resolved[key] = option.value ?? null;
			}

			if (resolved[key] && args[name]?.match === 'BOOLEAN') {
				resolved[key] = resolved[key] === 'true' ? true : false;
			}

			if (resolved[key] && args[key]?.match === 'COLOR') {
				resolved[key] = Util.resolveColor(resolved[key] as HexColorString);
			}
		}

		return resolved;
	}

	public async exec(interaction: CommandInteraction, command: Command) {
		if (this.preInhibitor(interaction, command)) return;

		const args = this.argumentRunner(interaction, command);
		try {
			this.emit(CommandHandlerEvents.COMMAND_EXECUTED, interaction, command, args);
			await command.exec(interaction, args);
		} catch (error) {
			this.emit(CommandHandlerEvents.ERROR, error, interaction, command);
		}
	}

	private preInhibitor(interaction: Interaction, command: Command) {
		const isOwner = this.client.isOwner(interaction.user);
		if (command.ownerOnly && !isOwner) {
			this.emit(CommandHandlerEvents.COMMAND_BLOCKED, interaction, command, BuiltInReasons.OWNER);
			return true;
		}

		if (command.channel === 'guild' && !interaction.inGuild()) {
			this.emit(CommandHandlerEvents.COMMAND_BLOCKED, interaction, command, BuiltInReasons.GUILD);
			return true;
		}

		if (command.channel === 'dm' && interaction.inGuild()) {
			this.emit(CommandHandlerEvents.COMMAND_BLOCKED, interaction, command, BuiltInReasons.DM);
			return true;
		}

		if (this.runPermissionChecks(interaction, command)) {
			return true;
		}

		const reason = this.client.inhibitorHandler.run(interaction, command);
		if (reason) {
			this.emit(CommandHandlerEvents.COMMAND_BLOCKED, interaction, command, reason);
			return true;
		}

		return false;
	}

	private runPermissionChecks(interaction: Interaction, command: Command) {
		if (!interaction.inGuild()) return false;

		if (command.clientPermissions?.length) {
			const missing = interaction.channel?.permissionsFor(this.client.user!)?.missing(command.clientPermissions);
			if (missing?.length) {
				this.emit(CommandHandlerEvents.MISSING_PERMISSIONS, interaction, command, 'client', missing);
				return true;
			}
		}

		if (command.userPermissions) {
			const missing = interaction.channel?.permissionsFor(interaction.user)?.missing(command.userPermissions);
			if (missing?.length) {
				this.emit(CommandHandlerEvents.MISSING_PERMISSIONS, interaction, command, 'user', missing);
				return true;
			}
		}

		return false;
	}
}

export class ListenerHandler extends BaseHandler {
	public override modules!: Collection<string, Listener>;
	private readonly emitters: Collection<string, EventEmitter>;

	public constructor(client: Client, { directory }: { directory: string }) {
		super(client, { directory });

		this.emitters = new Collection();
		container.register(ListenerHandler, { useValue: this });
	}

	public override construct(listener: Listener) {
		super.construct(listener);
		return this.addToEmitter(listener.id);
	}

	public addToEmitter(name: string) {
		const listener = this.modules.get(name)!;

		const emitter = {
			client: this.client as EventEmitter,
			commandHandler: this.client.commandHandler
		}[listener.emitter];

		if (!emitter) return;

		if (listener.once) {
			emitter.once(listener.event, listener.exec.bind(listener));
		} else {
			emitter.on(listener.event, listener.exec.bind(listener));
		}
	}
}

export class InhibitorHandler extends BaseHandler {
	public override modules!: Collection<string, Inhibitor>;

	public constructor(client: Client, { directory }: { directory: string }) {
		super(client, { directory });

		container.register(InhibitorHandler, { useValue: this });
	}

	public run(interaction: Interaction, command: Command) {
		const inhibitor = this.modules
			.sort((a, b) => b.priority - a.priority)
			.filter((inhibitor) => inhibitor.exec(interaction, command))
			.at(0);
		return Boolean(inhibitor?.reason);
	}
}

export interface CommandOptions {
	name: string;
	category?: string;
	ownerOnly?: string;
	channel?: 'dm' | 'guild';
	userPermissions?: PermissionString[];
	clientPermissions?: PermissionString[];
	description?: { content: string | string[]; usage?: string; examples?: string[] };
}

export class Command implements CommandOptions {
	public id: string;
	public name: string;
	public client: Client;
	public category?: string;
	public ownerOnly?: string;
	public channel?: 'dm' | 'guild';
	public userPermissions?: PermissionString[];
	public clientPermissions?: PermissionString[];
	public description?: { content: string | string[]; usage?: string; examples?: string[] };
	public handler: CommandHandler;

	public constructor(id: string, { name }: CommandOptions) {
		this.id = id;
		this.name = name;
		this.client = container.resolve(Client);
		this.handler = container.resolve(CommandHandler);
	}

	public args(): Args {
		return {};
	}

	public exec(interaction: Interaction, args: unknown): Promise<unknown> | unknown;
	public exec(): Promise<unknown> | unknown {
		throw Error('This method needs to be overwritten inside of an actual command.');
	}
}

export interface ListenerOptions {
	emitter: string;
	category?: string;
	once?: boolean;
	event: keyof ClientEvents;
}

export class Listener implements ListenerOptions {
	public id: string;
	public emitter: string;
	public category?: string;
	public event: keyof ClientEvents;
	public once?: boolean;
	public handler: ListenerHandler;
	public client: Client;

	public constructor(id: string, { emitter, event, once }: ListenerOptions) {
		this.id = id;
		this.event = event;
		this.once = once;
		this.emitter = emitter;
		this.client = container.resolve(Client);
		this.handler = container.resolve(ListenerHandler);
	}

	public exec(...args: any[]): Promise<unknown> | unknown;
	public exec(): Promise<unknown> | unknown {
		throw Error('This method needs to be overwritten inside of an actual listener.');
	}
}

export interface InhibitorOptions {
	id: string;
	category?: string;
	priority?: number;
	reason: string;
}

export class Inhibitor implements InhibitorOptions {
	public id: string;
	public reason: string;
	public category?: string;
	public priority: number;
	public handler: InhibitorHandler;
	public client: Client;

	public constructor(id: string, { category, priority, reason }: InhibitorOptions) {
		this.id = id;
		this.reason = reason;
		this.category = category;
		this.priority = priority ?? 0;
		this.client = container.resolve(Client);
		this.handler = container.resolve(InhibitorHandler);
	}

	public exec(interaction: Interaction, command: Command): boolean;
	public exec(): boolean {
		throw Error('This method needs to be overwritten inside of an actual inhibitor.');
	}
}
