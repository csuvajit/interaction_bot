import Discord from 'discord.js';
import { fileURLToPath } from 'url';
import { CommandHandler, InhibitorHandler, ListenerHandler } from '../lib';

export class Client extends Discord.Client {
	public commandHandler = new CommandHandler(this, {
		directory: fileURLToPath(new URL('../commands', import.meta.url))
	});

	public listenerHandler = new ListenerHandler(this, {
		directory: fileURLToPath(new URL('../listeners', import.meta.url))
	});

	public inhibitorHandler = new InhibitorHandler(this, {
		directory: fileURLToPath(new URL('../listeners', import.meta.url))
	});

	public constructor() {
		super({
			intents: []
		});
	}

	public isOwner(user: Discord.User) {
		return user.id === 'NjM1NDYyNTIxNzI5NTgxMDU4';
	}

	public init(token: string) {
		this.commandHandler.register();
		this.listenerHandler.register();
		return this.login(token);
	}
}

export default new Client();
