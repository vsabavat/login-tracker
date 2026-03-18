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
  const lat = payload.lat ?? payload.ip_geo?.latitude;
  const lon = payload.lon ?? payload.ip_geo?.longitude;

  if (lat == null || lon == null) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Missing lat/lon' }),
    };
  }

  // FIX: Read region from ip_geo.region (GitHub page format) or flat payload.region (CloudFront)
  const city    = payload.city    ?? payload.ip_geo?.city    ?? '';
  const region  = payload.region  ?? payload.ip_geo?.region  ?? '';   // FIXED: was always ''
  const country = payload.country ?? payload.ip_geo?.country_code ?? payload.ip_geo?.country_name ?? '';  // FIXED: was always ''
  const ip      = payload.ip      ?? payload.ip_geo?.ip      ?? '';

  const id = uuidv4();
  const ts = Date.now();

  try {
    await client.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        id:        { S: id },
        city:      { S: city },
        region:    { S: region },    // Now correctly stores "Washington" etc.
        country:   { S: country },   // Now correctly stores "US" (country_code) or country name
        latitude:  { N: String(lat) },
        longitude: { N: String(lon) },
        accuracy:  { S: String(payload.gps?.accuracy ?? payload.accuracy ?? '') },
        timestamp: { N: String(ts) },
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
