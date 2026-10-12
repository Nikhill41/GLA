import 'dotenv/config';
import {DynamoDBClient,CreateTableCommand} from '@aws-sdk/client-dynamodb';
const c=new DynamoDBClient({region:process.env.AWS_REGION});
const S=n=>({AttributeName:n,AttributeType:'S'}),K=(n,t='HASH')=>({AttributeName:n,KeyType:t});
const T=[
{TableName:'Users',AttributeDefinitions:[S('userId'),S('email')],KeySchema:[K('userId')],GlobalSecondaryIndexes:[{IndexName:'emailIndex',KeySchema:[K('email')],Projection:{ProjectionType:'ALL'}}]},
{TableName:'Requests',AttributeDefinitions:[S('requestId')],KeySchema:[K('requestId')]},
{TableName:'Matches',AttributeDefinitions:[S('matchId')],KeySchema:[K('matchId')]},
{TableName:'Messages',AttributeDefinitions:[S('matchId'),S('messageId')],KeySchema:[K('matchId'),K('messageId','RANGE')]},
{TableName:'Notifications',AttributeDefinitions:[S('recipientId'),S('notificationId')],KeySchema:[K('recipientId'),K('notificationId','RANGE')]}];
for(const t of T){try{await c.send(new CreateTableCommand({...t,BillingMode:'PAY_PER_REQUEST'}));console.log('created',t.TableName)}catch(e){console.log(t.TableName,e.name)}}
