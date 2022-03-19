export enum CommandHandlerEvents {
	COMMAND_ENDED = 'commandEnded',
	COMMAND_EXECUTED = 'commandExecuted',
	ERROR = 'error',
	COMMAND_INVALID = 'commandInvalid',
	COMMAND_DISABLED = 'commandDisabled',
	COMMAND_BLOCKED = 'commandBlocked',
	MISSING_PERMISSIONS = 'missingPermissions'
}

export enum BuiltInReasons {
	DM = 'dm',
	USER = 'user',
	GUILD = 'guild',
	CHANNEL = 'channel',
	CLIENT = 'client',
	OWNER = 'owner'
}
