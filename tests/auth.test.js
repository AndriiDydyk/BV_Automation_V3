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

describe.skip('Переказ з картки на картку', function () {
  describe('БВ => БВ (за номером картки)', function () {
    let token
    let payerCard
    let payerCardName
    let recipientCardNumber
    let amount

    before(async function () {
      const cardAccounts = await worker.getSessionValue('cardAccounts')
      const data = await worker.loadData()

      token = await worker.getSessionValue('token')
      payerCardName = data.payerCardName
      recipientCardNumber = data.bvRecipientCardNumber
      payerCard = await worker.findCardByName(cardAccounts, payerCardName)
      amount = await worker.randomAmount()
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

      before(async function () {
        const sessionGuid = await worker.getSessionValue('sessionGuid')

        const challange = await worker.decrypt_v2()
        const encryptData = await worker.encryptAndSign_v2({
          challengePass: challange
        })

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
        response = await request(baseUrl)
          .get('/payments/p2p/commission')
          .set('Authorization', `Bearer ${token}`)
          .send()

        await worker.setSessionValue(
          'totalAmount',
          response.body.commission.totalAmount
        )
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
        const sessionGuid = await worker.getSessionValue('sessionGuid')

        const challange = await worker.decrypt_v2()
        const encryptData = await worker.encryptAndSign_v2({
          challengePass: challange,
          password
        })

        response = await request(baseUrl)
          .post('/payments/p2p/confirm')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
            sessionGuid
          })

        await worker.setSessionValue(
          'payerContractId',
          response.body.payerContractId
        )
        await worker.setSessionValue('operation', response.body.operation)
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })

      it.skip('should contain valid JSON schema', function () {
        const schema = require('../json_schema/p2p_confirm.json')
        const valid = ajv.validate(schema, response.body)

        if (!valid) {
          console.error('Data does not match JSON schema:', ajv.errorsText())
          console.error(response.body)
        }

        expect(valid).to.be.true
      })

      it('should have correct payerContractId', () => {
        expect(response.body.payerContractId).to.equal(payerCard.contractId)
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

    describe('GET /history/operation', function () {
      let response
      let currentOperation

      before(async function () {
        await worker.waitForTime(5000)
        const contractId = payerCard.contractId

        response = await request(baseUrl)
          .get(`/history/operations?skip=0&contractId=${contractId}`)
          .set('Authorization', `Bearer ${token}`)
          .send()

        const operation = await worker.getSessionValue('operation')
        currentOperation = response.body.find(
          (item) => item.id === operation.id
        )

        if (!currentOperation) {
          throw new Error('Не вдалось знайти операції зі вказаним id')
        }
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })

      it('should contain valid JSON schema', function () {
        const schema = require('../json_schema/history_operation.json')
        const valid = ajv.validate(schema, response.body)

        if (!valid) {
          console.error('Data does not match JSON schema:', ajv.errorsText())
          console.error(response.body)
        }

        expect(valid).to.be.true
      })

      it('should return current operation', function () {
        expect(currentOperation).to.be.exist
      })

      it('should have correct subtitle (Переказ з картки на картку)', () => {
        expect(currentOperation.subtitle).to.equal(
          'Переказ з картки на картку'
        )
      })

      it('should have correct status', () => {
        expect(currentOperation.status).to.be.oneOf([
          'processing',
          'success',
          'fail'
        ])
      })

      it('should have correct dark icon URL', () => {
        expect(currentOperation.darkIcon).to.equal(
          'https://content.vostok.bank/vostokApp/payment-history/categories/logos/TransferCard-Dark.png'
        )
      })

      it('should have correct light icon URL', () => {
        expect(currentOperation.lightIcon).to.equal(
          'https://content.vostok.bank/vostokApp/payment-history/categories/logos/TransferCard-Light.png'
        )
      })
    })
  })

  describe('БВ => otherBank (за номером картки)', function () {
    let token
    let payerCard
    let payerCardName
    let recipientCardNumber
    let amount

    before(async function () {
      const cardAccounts = await worker.getSessionValue('cardAccounts')
      const data = await worker.loadData()

      token = await worker.getSessionValue('token')
      payerCardName = data.payerCardName
      recipientCardNumber = data.otherBankCardNumber
      payerCard = await worker.findCardByName(cardAccounts, payerCardName)
      amount = await worker.randomAmount()
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

      before(async function () {
        const sessionGuid = await worker.getSessionValue('sessionGuid')

        const challange = await worker.decrypt_v2()
        const encryptData = await worker.encryptAndSign_v2({
          challengePass: challange
        })

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
        response = await request(baseUrl)
          .get('/payments/p2p/commission')
          .set('Authorization', `Bearer ${token}`)
          .send()

        await worker.setSessionValue(
          'totalAmount',
          response.body.commission.totalAmount
        )
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
        const sessionGuid = await worker.getSessionValue('sessionGuid')

        const challange = await worker.decrypt_v2()
        const encryptData = await worker.encryptAndSign_v2({
          challengePass: challange,
          password
        })

        response = await request(baseUrl)
          .post('/payments/p2p/confirm')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
            sessionGuid
          })

        await worker.setSessionValue(
          'payerContractId',
          response.body.payerContractId
        )
        await worker.setSessionValue('operation', response.body.operation)
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })

      it.skip('should contain valid JSON schema', function () {
        const schema = require('../json_schema/p2p_confirm.json')
        const valid = ajv.validate(schema, response.body)

        if (!valid) {
          console.error('Data does not match JSON schema:', ajv.errorsText())
          console.error(response.body)
        }

        expect(valid).to.be.true
      })

      it('should have correct payerContractId', () => {
        expect(response.body.payerContractId).to.equal(payerCard.contractId)
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

    describe('GET /history/operation', function () {
      let response
      let currentOperation

      before(async function () {
        await worker.waitForTime(5000)
        const contractId = payerCard.contractId

        response = await request(baseUrl)
          .get(`/history/operations?skip=0&contractId=${contractId}`)
          .set('Authorization', `Bearer ${token}`)
          .send()

        const operation = await worker.getSessionValue('operation')
        currentOperation = response.body.find(
          (item) => item.id === operation.id
        )

        if (!currentOperation) {
          throw new Error('Не вдалось знайти операції зі вказаним id')
        }
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })

      it('should contain valid JSON schema', function () {
        const schema = require('../json_schema/history_operation.json')
        const valid = ajv.validate(schema, response.body)

        if (!valid) {
          console.error('Data does not match JSON schema:', ajv.errorsText())
          console.error(response.body)
        }

        expect(valid).to.be.true
      })

      it('should return current operation', function () {
        expect(currentOperation).to.be.exist
      })

      it('should have correct subtitle (Переказ з картки на картку)', () => {
        expect(currentOperation.subtitle).to.equal(
          'Переказ з картки на картку'
        )
      })

      it('should have correct status', () => {
        expect(currentOperation.status).to.be.oneOf([
          'processing',
          'success',
          'fail'
        ])
      })

      it('should have correct dark icon URL', () => {
        expect(currentOperation.darkIcon).to.equal(
          'https://content.vostok.bank/vostokApp/payment-history/categories/logos/TransferCard-Dark.png'
        )
      })

      it('should have correct light icon URL', () => {
        expect(currentOperation.lightIcon).to.equal(
          'https://content.vostok.bank/vostokApp/payment-history/categories/logos/TransferCard-Light.png'
        )
      })
    })
  })
})

describe.skip('Переказ з іншої картки', function () {
  let token
  let payerCardNumber
  let payerExpiryDate
  let payerCvv

  let amount

  before(async function () {
    token = await worker.getSessionValue('token')
  })

  describe('БВ(вручну) => БВ(власна)', function () {
    before(async function () {
      const data = await worker.loadData()
      amount = await worker.randomAmount()

      payerCardNumber = data.otherBankVostokCardNumber
      payerExpiryDate = data.otherBankVostokExpiryDate
      payerCvv = data.otherBankVostokCVV
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
    })

    describe('GET /p2p/setInput', function () {
      let response

      before(async function () {
        const sessionGuid = await worker.getSessionValue('sessionGuid')

        const challange = await worker.decrypt_v2()
        const encryptData = await worker.encryptAndSign_v2({
          challengePass: challange,
          cvv: payerCvv,
          expiryDate: payerExpiryDate
        })

        response = await request(baseUrl)
          .post('/payments/p2p/setInput')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
            sessionGuid,
            payerId: `cardNumber:${payerCardNumber}`,
            recipientId: 'cardNumber:5168130700506316',
            amount
          })

        const url = response.body['3ds'].url
        await worker.setSessionValue('cryptogram', response.body.cryptogram)
        await worker.openInBrowser(url)
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })

    describe('GET /p2p/commission', function () {
      let response

      before(async function () {
        await worker.waitForTime(20000)

        response = await request(baseUrl)
          .get('/payments/p2p/commission')
          .set('Authorization', `Bearer ${token}`)
          .send()
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })

    describe('GET /p2p/confirm', function () {
      let response

      before(async function () {
        const sessionGuid = await worker.getSessionValue('sessionGuid')

        const challange = await worker.decrypt_v2()
        const encryptData = await worker.encryptAndSign_v2({
          challengePass: challange,
          password
        })

        response = await request(baseUrl)
          .post('/payments/p2p/confirm')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
            sessionGuid
          })

        await worker.setSessionValue(
          'payerContractId',
          response.body.payerContractId
        )
        await worker.setSessionValue('operation', response.body.operation)
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })
  })

  describe('БВ(вручну) => otherBank(вручну)', function () {
    let recipientCardNumber

    before(async function () {
      const data = await worker.loadData()
      amount = await worker.randomAmount()

      payerCardNumber = data.otherBankVostokCardNumber
      payerExpiryDate = data.otherBankVostokExpiryDate
      payerCvv = data.otherBankVostokCVV

      recipientCardNumber = data.otherBankCardNumber
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
    })

    describe('GET /p2p/setInput', function () {
      let response

      before(async function () {
        const sessionGuid = await worker.getSessionValue('sessionGuid')

        const challange = await worker.decrypt_v2()
        const encryptData = await worker.encryptAndSign_v2({
          challengePass: challange,
          cvv: payerCvv,
          expiryDate: payerExpiryDate
        })

        response = await request(baseUrl)
          .post('/payments/p2p/setInput')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
            sessionGuid,
            payerId: `cardNumber:${payerCardNumber}`,
            recipientId: `cardNumber:${recipientCardNumber}`,
            amount
          })

        const url = response.body['3ds'].url
        await worker.setSessionValue('cryptogram', response.body.cryptogram)
        await worker.openInBrowser(url)
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })

    describe('GET /p2p/commission', function () {
      let response

      before(async function () {
        await worker.waitForTime(20000)

        response = await request(baseUrl)
          .get('/payments/p2p/commission')
          .set('Authorization', `Bearer ${token}`)
          .send()
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })

    describe('GET /p2p/confirm', function () {
      let response

      before(async function () {
        const sessionGuid = await worker.getSessionValue('sessionGuid')

        const challange = await worker.decrypt_v2()
        const encryptData = await worker.encryptAndSign_v2({
          challengePass: challange,
          password
        })

        response = await request(baseUrl)
          .post('/payments/p2p/confirm')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
            sessionGuid
          })

        await worker.setSessionValue(
          'payerContractId',
          response.body.payerContractId
        )
        await worker.setSessionValue('operation', response.body.operation)
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })
  })
})
