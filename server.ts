import serverModule from './server.cjs';

const config = serverModule.configFromEnv(process.env);
if (!config.databaseUrl) throw new Error('Falta DATABASE_URL.');
serverModule.createApp({...config, production: true}).listen(Number(process.env.PORT || 3000));
