const request = require('supertest')
const { before } = require('mocha')
const Worker = require('../helper/worker')
const Ajv = require('ajv')
const { expect } = require('chai')

const baseUrl = 'https://bv.api.vostok.bank'
const password = 'Qwerty12345'
const phoneNumber = '380660007201'

describe('Авторизація', function () {
  const ajv = new Ajv()
  const worker = new Worker()

  const otp = '111111'
  const password = 'Qwerty12345'

  let clientPrivateKey
  let clientPublicKey
  let device

  before(async () => {
    clientPrivateKey = await worker.getSessionValue('clientPrivateKey')
    clientPublicKey = await worker.getSessionValue('clientPublicKey')
    device = await worker.getSessionValue('iosReleaseDevice')
    // device = await worker.getSessionValue('iosDebugDevice')
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
      const cryptogram = await worker.getSessionValue('cryptogram')
      const serverPublicKey = await worker.getSessionValue('serverPublicKey')

      const challange = worker.decrypt(cryptogram, clientPrivateKey)
      const encryptData = worker.encryptAndSign(
        {
          challengePass: challange
        },
        serverPublicKey,
        clientPrivateKey
      )

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
      const cryptogram = await worker.getSessionValue('cryptogram')
      const serverPublicKey = await worker.getSessionValue('serverPublicKey')

      const challange = worker.decrypt(cryptogram, clientPrivateKey)
      const encryptData = worker.encryptAndSign(
        {
          challengePass: challange,
          otp
        },
        serverPublicKey,
        clientPrivateKey
      )

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
        this.skip() // Пропустити виконання тесту
      }
      expect(response.statusCode).to.equal(200)
    })

    it('should contain valid JSON schema', function () {
      if (!response) {
        this.skip() // Пропустити виконання тесту
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
      const cryptogram = await worker.getSessionValue('cryptogram')
      const serverPublicKey = await worker.getSessionValue('serverPublicKey')

      const challange = worker.decrypt(cryptogram, clientPrivateKey)
      const encryptData = worker.encryptAndSign(
        {
          challengePass: challange,
          password
        },
        serverPublicKey,
        clientPrivateKey
      )

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
  const ajv = new Ajv()
  const worker = new Worker()
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
})

describe('Переказ з картки на картку', function () {
  const ajv = new Ajv()
  const worker = new Worker()

  const payerCardName = 'Додаткова UAH'
  const recipientCardNumber = '5168130700992300'

  let token
  let clientPrivateKey

  before(async function () {
    this.timeout(20000)

    token = await worker.getSessionValue('token')
    clientPrivateKey = await worker.getSessionValue('clientPrivateKey')
  })

  describe('GET /p2p/markup', function () {
    let response

    before(async function () {
      response = await request(baseUrl)
        .get('/payments/p2p/markup')
        .set('Authorization', `Bearer ${token}`)
        .send()

      const cryptogram = response.body.cryptogram
      const sessionGuid = response.body.sessionGuid

      await worker.setSessionValue('cryptogram', cryptogram)
      await worker.setSessionValue('sessionGuid', sessionGuid)
    })

    it('should return 200 OK status code', function () {
      expect(response.statusCode).to.equal(200)
    })

    it('should contain valid JSON schema', function () {
      const schema = require('../json_schema/p2p_markup.json')
      const valid = ajv.validate(schema, response.body)

      if (!valid) {
        console.error('Data does not match JSON schema:', ajv.errorsText())
        console.error(response.body)
      }

      expect(valid).to.be.true
    })
  })

  describe('GET /p2p/setInput', function () {
    let response
    let payerCard

    before(async function () {
      this.timeout(20000)

      const cardAccounts = await worker.getSessionValue('cardAccounts')
      const cryptogram = await worker.getSessionValue('cryptogram')
      const sessionGuid = await worker.getSessionValue('sessionGuid')
      const serverPublicKey = await worker.getSessionValue('serverPublicKey')

      const challange = worker.decrypt(cryptogram, clientPrivateKey)
      const encryptData = worker.encryptAndSign(
        {
          challengePass: challange
        },
        serverPublicKey,
        clientPrivateKey
      )

      payerCard = await worker.findCardByName(cardAccounts, payerCardName)
      const amount = await worker.randomAmount()

      response = await request(baseUrl)
        .post('/payments/p2p/setInput')
        .set('Authorization', `Bearer ${token}`)
        .send({
          sign: encryptData.sign,
          cryptogram: encryptData.cryptogram,
          sessionGuid,
          payerId: `cardNumber:${payerCard.cards[0].cardNumber}`,
          recipientId: `cardNumber:${recipientCardNumber}`,
          amount
        })

      await worker.setSessionValue('cryptogram', response.body.cryptogram)
    })

    it('should return 200 OK status code', function () {
      expect(response.statusCode).to.equal(200)
    })

    it('should contain valid JSON schema', function () {
      const schema = require('../json_schema/p2p_setInput.json')
      const valid = ajv.validate(schema, response.body)

      if (!valid) {
        console.error('Data does not match JSON schema:', ajv.errorsText())
        console.error(response.body)
      }

      expect(valid).to.be.true
    })
  })

  describe('GET /p2p/commission', function () {
    let response

    before(async function () {
      this.timeout(20000)

      response = await request(baseUrl)
        .get('/payments/p2p/commission')
        .set('Authorization', `Bearer ${token}`)
        .send()
    })

    it('should return 200 OK status code', function () {
      expect(response.statusCode).to.equal(200)
    })

    it('should contain valid JSON schema', function () {
      const schema = require('../json_schema/p2p_commission.json')
      const valid = ajv.validate(schema, response.body)

      if (!valid) {
        console.error('Data does not match JSON schema:', ajv.errorsText())
        console.error(response.body)
      }

      expect(valid).to.be.true
    })
  })

  describe('GET /p2p/confirm', function () {
    let response

    before(async function () {
      this.timeout(20000)

      const cryptogram = await worker.getSessionValue('cryptogram')
      const sessionGuid = await worker.getSessionValue('sessionGuid')
      const serverPublicKey = await worker.getSessionValue('serverPublicKey')

      const challange = worker.decrypt(cryptogram, clientPrivateKey)
      const encryptData = worker.encryptAndSign(
        {
          challengePass: challange,
          password
        },
        serverPublicKey,
        clientPrivateKey
      )

      response = await request(baseUrl)
        .post('/payments/p2p/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({
          sign: encryptData.sign,
          cryptogram: encryptData.cryptogram,
          sessionGuid
        })

      await worker.setSessionValue('cryptogram', response.body.cryptogram)
    })

    it('should return 200 OK status code', function () {
      expect(response.statusCode).to.equal(200)
    })

    it('should contain valid JSON schema', function () {
      const schema = require('../json_schema/p2p_confirm.json')
      const valid = ajv.validate(schema, response.body)

      if (!valid) {
        console.error('Data does not match JSON schema:', ajv.errorsText())
        console.error(response.body)
      }

      expect(valid).to.be.true
    })

    it('should have correct title (Переказ з картки на картку)', () => {
      expect(response.body.operation.title).to.equal(
        'Переказ з картки на картку'
      )
    })

    it('should have correct subtitle (Переказ з картки на картку)', () => {
      expect(response.body.operation.subtitle).to.equal(
        'Переказ з картки на картку'
      )
    })

    it('should have correct status (processing)', () => {
      expect(response.body.operation.status).to.equal('processing')
    })

    it('should have correct dark icon URL', () => {
      expect(response.body.operation.darkIcon).to.equal(
        'https://content.vostok.bank/vostokApp/payment-history/categories/logos/TransferCard-Dark.png'
      )
    })

    it('should have correct light icon URL', () => {
      expect(response.body.operation.lightIcon).to.equal(
        'https://content.vostok.bank/vostokApp/payment-history/categories/logos/TransferCard-Light.png'
      )
    })
  })
})
