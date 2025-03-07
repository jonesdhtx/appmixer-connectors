'use strict';
const { getClient, getCollection, getChangeStream, getReplicaSetStatus, ensureStore, setOperationalTimestamp, processDocuments } = require('../../common');
module.exports = {

    async start(context) {

        const client = await getClient(context.auth);
        try {
            const isReplicaSet = await getReplicaSetStatus(client);
            // await context.log({ isReplicaSet, start: true });
            await context.stateSet('isReplicaSet', isReplicaSet);
            if (isReplicaSet) {
                await setOperationalTimestamp(context);
                return;
            }

            const storeId = await ensureStore(context, 'UpdatedDoc-' + context.componentId);
            await processDocuments({ client, context, storeId });
            await context.store.registerWebhook(storeId, ['insert', 'update']);
        } finally {
            await client.close();
        }
    },

    async receive(context) {

        if (context.messages.webhook.content.data.type === 'update') {
            const item = context.messages.webhook.content.data.currentValue;
            await context.sendJson({ document: item.value, oldDocument: item.oldValue }, 'out');
            return context.response('ok');
        }
    },

    async stop(context) {

        const client = await getClient(context.auth);
        try {
            const isReplicaSet = await getReplicaSetStatus(client);
            if (isReplicaSet) return;
            const savedStoredId = await context.stateGet('storeId');
            await context.store.unregisterWebhook(savedStoredId);
        } finally {
            await client.close();
        }
    },

    async tick(context) {

        const client = await getClient(context.auth);
        let lock;
        try {
            lock = await context.lock('MongoDbNewDoc-' + context.componentId, {
                ttl: 1000 * 60 * 5,
                maxRetryCount: 0
            });
        } catch (err) {
            return;
        }
        try {
            const isReplicaSet = await context.stateGet('isReplicaSet');
            if (isReplicaSet) {
                // let resumeToken;
                const collection = getCollection(client, context.auth.database, context.properties.collection);
                const resumeToken = await context.stateGet('resumeToken');
                let startAtOperationTime;
                if (!resumeToken) {
                    startAtOperationTime = await context.stateGet('startAtOperationTime');
                }
                const changeStream = getChangeStream('update', collection, { resumeToken, startAtOperationTime });

                try {
                    while (await changeStream.hasNext()) {
                        const next = await changeStream.next();
                        const jsonDoc = JSON.parse(JSON.stringify(next.documentKey));
                        await context.sendJson({ document: { ...jsonDoc, ...next.updateDescription } }, 'out');
                        await context.stateSet('resumeToken', changeStream.resumeToken['_data']);

                    }
                } catch (error) {
                    throw error;
                }
                // await new Promise(r => setTimeout(r, context.config.changeStreamsTimeout || 55000));
                // changeStream.close();
            } else {
                const storeId = await context.stateGet('storeId');

                await processDocuments({ lock, client, context, storeId });
            }
        } finally {
            await client.close();
            lock && await lock.unlock();
        }
    }
};
