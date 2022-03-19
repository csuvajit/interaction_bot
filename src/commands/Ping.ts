import { CommandInteraction } from 'discord.js';
import { Args, Command } from '../lib';

export default class Ping extends Command {
	public constructor() {
		super('ping', { name: 'ping' });
	}

	public override args(): Args {
		return {
			'user': {
				match: 'USER'
			},
			'co-leads': {
				id: 'role',
				match: 'ROLE'
			},
			'verify': {
				match: 'BOOLEAN'
			}
		};
	}

	public exec(interaction: CommandInteraction, args: any) {
		console.log(args);
		console.log(this.handler);
		return interaction.reply('Pong!');
	}
}
