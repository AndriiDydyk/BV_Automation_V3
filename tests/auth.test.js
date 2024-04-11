const request = require('supertest')
const { before } = require('mocha')
const Worker = require('../helper/worker')
const Ajv = require('ajv')
const { expect } = require('chai')

const ajv = new Ajv()
const worker = new Worker()

const baseUrl = 'https://bv.test.api.vostok.bank'
let phoneNumber
let password

describe('', function(){
  describe('Авторизація', function () {
    let otp
    let clientPublicKey
    let device
  
    before(async () => {
      await worker.loadKeys()
      await worker.loadDevices()
  
      const data = await worker.loadData()
      phoneNumber = data.phoneNumber
      otp = data.otp
      password = data.password
  
      clientPublicKey = await worker.getSessionValue('clientPublicKey')
      device = await worker.getSessionValue('iosDebugDevice')
    })
  
    describe('POST /start', function () {
      let response
  
      before(async () => {
        response = await request(baseUrl).post('/auth/v3/start').send({
          clientPublicKey,
          phoneNumber,
          device
        })
        const token = response.body.token
        const serverPublicKey = response.body.serverPublicKey
        const cryptogram = response.body.cryptogram
  
        await worker.setSessionValue('token', token)
        await worker.setSessionValue('serverPublicKey', serverPublicKey)
        await worker.setSessionValue('cryptogram', cryptogram)
      })
  
      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
  
      it('should contain valid JSON schema', function () {
        const schema = {
          type: 'object',
          properties: {
            serverPublicKey: { type: 'string' },
            token: { type: 'string' },
            sign: { type: 'string' },
            cryptogram: { type: 'string' }
          },
          required: ['serverPublicKey', 'token', 'sign', 'cryptogram']
        }
        const valid = ajv.validate(schema, response.body)
  
        if (!valid) {
          console.error('Data does not match JSON schema:', ajv.errorsText())
          console.error(response.body)
        }
  
        expect(valid).to.be.true
      })
    })
  
    describe('POST /nextStep', function () {
      let response
  
      before(async () => {
        const token = await worker.getSessionValue('token')
  
        const challange = await worker.decrypt_v2()
        const encryptData = await worker.encryptAndSign_v2({
          challengePass: challange
        })
  
        response = await request(baseUrl)
          .post('/auth/v4/nextstep')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram
          })
        await worker.setSessionValue('cryptogram', response.body.cryptogram)
        await worker.setSessionValue('nextStep', response.body.nextStep)
      })
  
      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
  
      it('should contain valid JSON schema', function () {
        const schema = {
          type: 'object',
          properties: {
            sign: { type: 'string' },
            cryptogram: { type: 'string' }
          },
          required: ['sign', 'cryptogram']
        }
        const valid = ajv.validate(schema, response.body)
  
        if (!valid) {
          console.error('Data does not match JSON schema:', ajv.errorsText())
          console.error(response.body)
        }
  
        expect(valid).to.be.true
      })
    })
  
    describe('POST /otp/confirm', function () {
      let response
  
      before(async () => {
        const nextStep = await worker.getSessionValue('nextStep')
        if (nextStep !== 'requestOtp') {
          return
        }
  
        const token = await worker.getSessionValue('token')
  
        const challange = await worker.decrypt_v2()
        const encryptData = await worker.encryptAndSign_v2({
          challengePass: challange,
          otp
        })
  
        response = await request(baseUrl)
          .post('/auth/v4/otp/confirm')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram
          })
        await worker.setSessionValue('cryptogram', response.body.cryptogram)
        await worker.setSessionValue('nextStep', response.body.nextStep)
      })
  
      it('should return 200 OK status code', function () {
        if (!response) {
          this.skip()
        }
        expect(response.statusCode).to.equal(200)
      })
  
      it('should contain valid JSON schema', function () {
        if (!response) {
          this.skip()
        }
        const schema = {
          type: 'object',
          properties: {
            sign: { type: 'string' },
            cryptogram: { type: 'string' }
          },
          required: ['sign', 'cryptogram']
        }
        const valid = ajv.validate(schema, response.body)
  
        if (!valid) {
          console.error('Data does not match JSON schema:', ajv.errorsText())
          console.error(response.body)
        }
  
        expect(valid).to.be.true
      })
    })
  
    describe('POST /enterpassword', function () {
      let response
  
      before(async () => {
        const nextStep = await worker.getSessionValue('nextStep')
        if (nextStep !== 'enterPassword') {
          return
        }
  
        const token = await worker.getSessionValue('token')
  
        const challange = await worker.decrypt_v2()
        const encryptData = await worker.encryptAndSign_v2({
          challengePass: challange,
          password
        })
  
        response = await request(baseUrl)
          .post('/auth/v3/enterpassword')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram
          })
        await worker.setSessionValue('cryptogram', response.body.cryptogram)
        await worker.setSessionValue('nextStep', response.body.nextStep)
        await worker.setSessionValue('token', response.body.token)
      })
  
      it('should return 200 OK status code', function () {
        if (!response) {
          this.skip()
        }
        expect(response.statusCode).to.equal(200)
      })
  
      it('should contain valid JSON schema', function () {
        if (!response) {
          this.skip()
        }
        const schema = {
          type: 'object',
          properties: {
            token: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            nextStep: { type: 'string' },
            sign: { type: 'string' },
            cryptogram: { type: 'string' }
          },
          required: ['token', 'name', 'email', 'nextStep', 'sign', 'cryptogram']
        }
        const valid = ajv.validate(schema, response.body)
  
        if (!valid) {
          console.error('Data does not match JSON schema:', ajv.errorsText())
          console.error(response.body)
        }
  
        expect(valid).to.be.true
      })
    })
  })
  
  describe('Дашборд', function () {
    let token
  
    before(async () => {
      token = await worker.getSessionValue('token')
    })
  
    describe('GET /cards', function () {
      let response
  
      before(async () => {
        response = await request(baseUrl)
          .get('/cards/v3?forceCacheReload=true')
          .set('Authorization', `Bearer ${token}`)
          .send()
  
        const cardAccounts = response.body
        await worker.setSessionValue('cardAccounts', cardAccounts)
      })
  
      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
  
      it('should contain valid JSON schema', function () {
        const schema = require('../json_schema/cards.json')
        const valid = ajv.validate(schema, response.body)
  
        if (!valid) {
          console.error('Data does not match JSON schema:', ajv.errorsText())
          console.error(response.body)
        }
  
        expect(valid).to.be.true
      })
    })
  
    describe('GET /notifications', function () {
      let response
  
      before(async () => {
        response = await request(baseUrl)
          .get('/notifications/v2?skip=0')
          .set('Authorization', `Bearer ${token}`)
          .send()
      })
  
      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
  
      it('should contain valid JSON schema', function () {
        const schema = require('../json_schema/notifications.json')
        const valid = ajv.validate(schema, response.body)
  
        if (!valid) {
          console.error('Data does not match JSON schema:', ajv.errorsText())
          console.error(response.body)
        }
  
        expect(valid).to.be.true
      })
    })
  
    describe('GET /history/propositions', function () {
      let response
  
      before(async () => {
        response = await request(baseUrl)
          .get('/history/propositions')
          .set('Authorization', `Bearer ${token}`)
          .send()
      })
  
      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
  
      it('should contain valid JSON schema', function () {
        const schema = require('../json_schema/history_propositions.json')
        const valid = ajv.validate(schema, response.body)
  
        if (!valid) {
          console.error('Data does not match JSON schema:', ajv.errorsText())
          console.error(response.body)
        }
  
        expect(valid).to.be.true
      })
    })
  
    describe('GET /profile/user/statuses', function () {
      let response
  
      before(async () => {
        response = await request(baseUrl)
          .get('/profile/user/statuses')
          .set('Authorization', `Bearer ${token}`)
          .send()
      })
  
      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
  
      it('should contain valid JSON schema', function () {
        const schema = require('../json_schema/user_statuses.json')
        const valid = ajv.validate(schema, response.body)
  
        if (!valid) {
          console.error('Data does not match JSON schema:', ajv.errorsText())
          console.error(response.body)
        }
  
        expect(valid).to.be.true
      })
    })
  
    describe('GET /marketplaceRate/checkStatus', function () {
      let response
  
      before(async () => {
        response = await request(baseUrl)
          .get('/marketplaceRate/checkStatus')
          .set('Authorization', `Bearer ${token}`)
          .send()
      })
  
      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
  
      it('should contain valid JSON schema', function () {
        const schema = require('../json_schema/marketplace_rate.json')
        const valid = ajv.validate(schema, response.body)
  
        if (!valid) {
          console.error('Data does not match JSON schema:', ajv.errorsText())
          console.error(response.body)
        }
  
        expect(valid).to.be.true
      })
    })
  })

  after(async () => {
    await worker.openInBrowser('/Volumes/SSD/Projects/BV_Automation_V3/mochawesome-report/mochawesome.html')
  })
})

