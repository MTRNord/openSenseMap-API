'use strict';

const mongoose = require('mongoose'),
  Schema = mongoose.Schema,
  mqttClient = require('../mqtt'),
  utils = require('../utils'),
  isJSONParseableValidation = [utils.isJSONParseable, '{PATH} is not parseable as JSON'];

// MQTT broker integration data
const mqttSchema = new Schema({
  enabled: { type: Boolean, default: false, required: true },
  url: { type: String, trim: true, validate: [function validMqttUri (url) { return url === '' || url.startsWith('mqtt://') || url.startsWith('ws://'); }, '{PATH} must be either empty or start with mqtt:// or ws://'] },
  topic: { type: String, trim: true },
  messageFormat: { type: String, trim: true, enum: ['json', 'csv', 'application/json', 'text/csv', 'debug_plain', ''] },
  decodeOptions: { type: String, trim: true, validate: isJSONParseableValidation },
  connectionOptions: { type: String, trim: true, validate: isJSONParseableValidation }
}, { _id: false });

// thethingsnetwork.org integration data
const ttnSchema = new Schema({
  dev_id: { type: String, trim: true, required: true },
  app_id: { type: String, trim: true, required: true },
  messageFormat: { type: String, trim: true, enum: ['json', 'bytes'], required: true },
  decodeOptions: {
    profile: { type: String, trim: true, enum: ['custom', 'sensebox/home'] },
    byteMask: { type: [Number] }
  }
}, { _id: false });

const integrationSchema = new Schema({
  mqtt: {
    type: mqttSchema,
    required: false,
    validate: [function validMqttConfig (mqtt) {
      if (mqtt.enabled === true) {
        if (!utils.isNonEmptyString(mqtt.url)) {
          return false;
        }
        if (!utils.isNonEmptyString(mqtt.topic)) {
          return false;
        }
        if (!utils.isNonEmptyString(mqtt.messageFormat)) {
          return false;
        }
      }

      return true;
    }, 'if {PATH} is true, url, topic and messageFormat should\'t be empty or invalid']
  },

  ttn: {
    type: ttnSchema,
    required: false,
    validate: [{
      /* eslint-disable func-name-matching */
      validator: function validTTNMessageFormat (ttn) {
      /* eslint-enable func-name-matching */
        return !(ttn.messageFormat === 'bytes' && !utils.isNonEmptyString(ttn.decodeOptions.profile));
      },
      msg: 'if messageFormat is "bytes", there must be a profile specified'
    }, {
      /* eslint-disable func-name-matching */
      validator: function validTTNDecodeOptions (ttn) {
      /* eslint-enable func-name-matching */
        return !(ttn.decodeOptions.profile === 'custom'
          && typeof ttn.decodeOptions.byteMask === 'undefined');
      },
      msg: 'if decodeOptions.profile is "custom" there must be byte mask specified'
    }]
  }
}, { _id: false });


const addIntegrationsToSchema = function addIntegrationsToSchema (schema) {
  schema.add({ integrations: { type: integrationSchema } });

  // flag whether mqtt options have changed
  schema.pre('save', function integrationsPreSave (next) {
    if (this.modifiedPaths && typeof this.modifiedPaths === 'function') {
      this._mqttChanged = this.modifiedPaths().some(function eachPath (path) {
        return path.includes('mqtt');
      });
    }
    next();
  });

  // reconnect when mqtt option change was flagged
  schema.post('save', function integrationsPostSave (box) {
    if (box._mqttChanged === true) {
      if (box.integrations.mqtt.enabled === true) {
        console.log('mqtt credentials changed, reconnecting');
        mqttClient.connect(box);
      } else if (box.integrations.mqtt.enabled === false) {
        mqttClient.disconnect(box);
      }
    }
    box._mqttChanged = undefined;
  });

  // disconnect mqtt on removal
  schema.pre('remove', function integrationsPostRemove (next) {
    mqttClient.disconnect(this);
    next();
  });
};

module.exports = {
  schema: integrationSchema,
  addToSchema: addIntegrationsToSchema,
  // no model, bc its used as subdocument in boxSchema!
};