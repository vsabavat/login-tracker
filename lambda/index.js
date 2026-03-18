// login-tracker Lambda function
// Endpoint: POST /track
// Accepts both flat format (from CloudFront page) and nested ip_geo format (from GitHub page)
// Stores visitor data to DynamoDB

const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { v4: uuidv4 } = require('uuid');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const TABLE = process.env.TABLE_NAME || 'login-tracker';

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS' || event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON' }) };
  }

  // Support both flat format { lat, lon, city, region, country } (CloudFront page)
  // and nested format { ip_geo: { latitude, longitude, city, region, country_code } } (GitHub page)
  // and GPS format { gps: { lat, lon } }
  const { lat, lon, city, region, country, ip, ip_geo, gps } = payload;

  // Resolve fields from flat payload OR nested ip_geo object OR gps object
  const resolvedLat     = lat     ?? ip_geo?.latitude  ?? gps?.lat;
  const resolvedLon     = lon     ?? ip_geo?.longitude ?? gps?.lon;
  const resolvedCity    = city    ?? ip_geo?.city;
  const resolvedRegion  = region  ?? ip_geo?.region;
  const resolvedCountry = country ?? ip_geo?.country_code ?? ip_geo?.country_name;
  const resolvedIp      = ip      ?? ip_geo?.ip;

  if (resolvedLat == null || resolvedLon == null) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Missing lat/lon' }),
    };
  }

  const id = uuidv4();
  const ts = Date.now();

  try {
    await client.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        id:        { S: id },
        city:      { S: resolvedCity    ?? '' },
        region:    { S: resolvedRegion  ?? '' },
        country:   { S: resolvedCountry ?? '' },
        latitude:  { N: String(resolvedLat) },
        longitude: { N: String(resolvedLon) },
        accuracy:  { S: String(gps?.accuracy ?? payload.accuracy ?? '') },
        timestamp: { N: String(ts) },
        ip:        { S: resolvedIp ?? '' },
        email:     { S: payload.email ?? '' },
      },
    }));
  } catch (err) {
    console.error('DynamoDB error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Storage error' }),
    };
  }

  return {
    statusCode: 204,
    headers: { 'Access-Control-Allow-Origin': '*' },
  };
};
