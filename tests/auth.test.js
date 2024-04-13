// eslint-disable-next-line no-unused-expressionsсду
const request = require('supertest')
const { before } = require('mocha')
const Worker = require('../helper/worker')
const CryptoManager = require('../helper/cryptoManager')
// const Ajv = require('ajv')
const { expect } = require('chai')

const worker = new Worker()
const cryptoManager = new CryptoManager()

describe('', function () {
  let host
  let device
  let phoneNumber
  let otp
  let password

  before(async () => {
    const config = await worker.loadEnvironments()
    const env = config.test

    host = env.host
    phoneNumber = env.phoneNumber
    otp = env.otp
    password = env.password
    device = env.device
  })

  describe('Авторизація', function () {
    let clientPublicKey

    before(async () => {
      await worker.loadKeys()

      clientPublicKey = await worker.getSessionValue('clientPublicKey')
    })

    describe('POST /start', function () {
      let response

      before(async () => {
        response = await request(host).post('/auth/v3/start').send({
          clientPublicKey,
          phoneNumber,
          device
        })

        const { token, serverPublicKey, cryptogram } = response.body

        await worker.setMultipleSessionValues({
          token,
          serverPublicKey,
          cryptogram
        })
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })

    describe('POST /nextStep', function () {
      let response

      before(async () => {
        const token = await worker.getSessionValue('token')

        const encryptData = await cryptoManager.encryptAndSign({})

        response = await request(host)
          .post('/auth/v4/nextstep')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram
          })

        const { cryptogram, nextStep } = response.body

        await worker.setMultipleSessionValues({
          cryptogram,
          nextStep
        })
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
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
        const encryptData = await cryptoManager.encryptAndSign({ otp })

        response = await request(host)
          .post('/auth/v4/otp/confirm')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram
          })

        await worker.setMultipleSessionValues({
          cryptogram: response.body.cryptogram,
          nextStep: response.body.nextStep
        })
      })

      it('should return 200 OK status code', function () {
        if (!response) {
          this.skip()
        }
        expect(response.statusCode).to.equal(200)
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
        const encryptData = await cryptoManager.encryptAndSign({ password })

        response = await request(host)
          .post('/auth/v3/enterpassword')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram
          })

        await worker.setSessionValue('token', response.body.token)
      })

      it('should return 200 OK status code', function () {
        if (!response) {
          this.skip()
        }
        expect(response.statusCode).to.equal(200)
      })
    })
  })

  describe('Дашборд', function () {
    let token
    let response
    before(async () => {
      token = await worker.getSessionValue('token')
    })

    describe('GET /cards', function () {
      before(async function () {
        response = await request(host)
          .get('/cards/v3?forceCacheReload=true')
          .set('Authorization', `Bearer ${token}`)
          .send()

        if (!response || response.statusCode !== 200) {
          this.skip()
        }
        await worker.setSessionValue('cardAccounts', response?.body)
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })
  })

  describe('Поповнення мобільного', function () {
    let token
    let payerCard
    let payerCardId
    let recipient
    let amount
    let stopRun

    before(async () => {
      token = await worker.getSessionValue('token')
      const cardAccounts = await worker.getSessionValue('cardAccounts')
      const data = await worker.loadData()
      const payerCardName = data.payerCardName

      payerCard = await worker.findCardByName(cardAccounts, payerCardName)
      payerCardId = payerCard.cards[0].id
      amount = await worker.randomAmount()
      recipient = data.recipientMobileMulti
      stopRun = false
    })

    before(function () {
      if (stopRun) {
        this.skip()
      }
    })

    describe('GET /mobilemulti/markup', function () {
      let response

      before(async () => {
        response = await request(host)
          .get('/payments/service/mobilemulti/markup')
          .set('Authorization', `Bearer ${token}`)
          .send()

        if (!response || response.statusCode !== 200) {
          stopRun = true
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`
          )
        } else {
          await worker.setMultipleSessionValues({
            cryptogram: response.body.cryptogram,
            sessionGuid: response.body.sessionGuid
          })
        }
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })

    describe('POST /mobilemulti/setInput', function () {
      let response

      before(async function () {
        if (stopRun === true) {
          this.skip()
        }
        const sessionGuid = await worker.getSessionValue('sessionGuid')

        const encryptData = await cryptoManager.encryptAndSign({
          controls: [
            {
              Name: 'PayeeId',
              Value: `card:${payerCardId}`
            },
            {
              Name: 'PhoneNumber',
              Value: recipient
            },
            {
              Name: 'Amount',
              Value: amount
            }
          ]
        })

        response = await request(host)
          .post('/payments/v2/service/MobileMulti/setinput')
          .set('Authorization', `Bearer ${token}`)
          .send({
            cryptogram: encryptData.cryptogram,
            sign: encryptData.sign,
            sessionGuid
          })
        if (!response || response.statusCode !== 200) {
          stopRun = true
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`
          )
        } else {
          await worker.setSessionValue('cryptogram', response.body.cryptogram)
        }
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })

    describe('GET /mobilemulti/commission', function () {
      let response

      before(async function () {
        if (stopRun === true) {
          this.skip()
        }

        response = await request(host)
          .get('/payments/v2/service/MobileMulti/commission')
          .set('Authorization', `Bearer ${token}`)
          .send()
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })

    describe('POST /mobilemulti/confirm', function () {
      let response

      before(async function () {
        if (stopRun === true) {
          this.skip()
        }
        const sessionGuid = await worker.getSessionValue('sessionGuid')

        const encryptData = await cryptoManager.encryptAndSign({
          password
        })
        response = await request(host)
          .post('/payments/service/MobileMulti/confirm')
          .set('Authorization', `Bearer ${token}`)
          .send({
            cryptogram: encryptData.cryptogram,
            sign: encryptData.sign,
            sessionGuid
          })
        if (!response || response.statusCode !== 200) {
          stopRun = true
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`
          )
        } else {
          await worker.setSessionValue('cryptogram', response.body.cryptogram)
        }
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })

      it('should be able to save as template', function () {
        expect(response.body.canBeSavedAsTemplate).to.equal(true)
      })

      it('should have correct payerContractId', function () {
        expect(response.body.payerContractId).to.equal(payerCard.contractId)
      })

      it("should have property 'operation'", function () {
        expect(response.body).to.has.property('operation')
      })

      it('operation should have correct title', function () {
        expect(response.body.operation.title).to.equal('Поповнення мобільного')
      })

      it('operation should have correct subtitle', function () {
        expect(response.body.operation.subtitle).to.equal("Мобільний зв'язок")
      })

      it("operation should have status 'processing'", function () {
        expect(response.body.operation.status).to.equal('processing')
      })

      it('operation should have correct darkIcon', function () {
        expect(response.body.operation.darkIcon).to.equal(
          'https://content.vostok.bank/vostokApp/payment-history/categories/logos/mobile-Dark.png'
        )
      })

      it('operation should have correct lightIcon', function () {
        expect(response.body.operation.lightIcon).to.equal(
          'https://content.vostok.bank/vostokApp/payment-history/categories/logos/mobile-Light.png'
        )
      })
    })

    describe.skip('POST saveAsTemplate', function () {
      let response

      before(async () => {
        const challange = await worker.decrypt_v2()
        const encryptData = await worker.encryptAndSign_v2({
          challengePass: challange
        })
        response = await request(host)
          .post('/payments/service/MobileMulti/saveAsTemplate')
          .set('Authorization', `Bearer ${token}`)
          .send({
            cryptogram: encryptData.cryptogram,
            sign: encryptData.sign,
            name: `Vodafone, ${recipient}`
          })

        await worker.setSessionValue('cryptogram', response.body.cryptogram)
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })
  })

  describe('Переказ з картки на картку', function () {
    let stopRun
    let token
    let payerCard
    let recipient
    let amount

    before(async () => {
      token = await worker.getSessionValue('token')

      const cardAccounts = await worker.getSessionValue('cardAccounts')
      const data = await worker.loadData()
      const payerCardName = data.payerCardName

      payerCard = await worker.findCardByName(cardAccounts, payerCardName)
      recipient = '5168130700722715'
      amount = await worker.randomAmount()
      stopRun = false
    })

    before(function () {
      if (stopRun) {
        this.skip
      }
    })

    describe('GET /p2p/markup', function () {
      let response

      before(async () => {
        response = await request(host)
          .get('/payments/p2p/markup')
          .set('Authorization', `Bearer ${token}`)
          .send()

        if (!response || response.statusCode !== 200) {
          stopRun = true
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`
          )
        } else {
          await worker.setMultipleSessionValues({
            cryptogram: response.body.cryptogram,
            sessionGuid: response.body.sessionGuid
          })
        }
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })

    describe('POST /p2p/setInput', function () {
      let response

      before(async () => {
        if (stopRun === true) {
          this.skip()
        }
        const sessionGuid = await worker.getSessionValue('sessionGuid')
        const encryptData = await cryptoManager.encryptAndSign({})
        const payerCardNumber = payerCard.cards[0].cardNumber

        response = await request(host)
          .post('/payments/p2p/setInput')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
            sessionGuid,
            payerId: `cardNumber:${payerCardNumber}`,
            recipientId: `cardNumber:${recipient}`,
            amount
          })

        if (!response || response.statusCode !== 200) {
          stopRun = true
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`
          )
        } else {
          await worker.setSessionValue('cryptogram', response.body.cryptogram)
        }
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })

    describe('GET /p2p/commission', function () {
      let response

      before(async () => {
        if (stopRun === true) {
          this.skip()
        }

        response = await request(host)
          .get('/payments/p2p/commission')
          .set('Authorization', `Bearer ${token}`)
          .send()

        if (!response || response.statusCode !== 200) {
          stopRun = true
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`
          )
        }
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })

    describe('POST /p2p/confirm', function () {
      let response

      before(async () => {
        if (stopRun === true) {
          this.skip()
        }

        const sessionGuid = await worker.getSessionValue('sessionGuid')
        const encryptData = await cryptoManager.encryptAndSign({
          password
        })

        response = await request(host)
          .post('/payments/p2p/confirm')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
            sessionGuid
          })

        if (!response || response.statusCode !== 200) {
          stopRun = true
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`
          )
        } else {
          await worker.setSessionValue('cryptogram', response.body.cryptogram)
        }
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })

    describe('POST /saveCard', function () {
      let response

      before(async () => {
        if (stopRun === true) {
          this.skip()
        }
        
        const encryptData = await cryptoManager.encryptAndSign({
          password
        })

        response = await request(host)
          .post('/payments/savedCards/saveFromLastPayment')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
            cardName: 'Дидик А.В. | Vostok (test)'
          })

        if (!response || response.statusCode !== 200) {
          stopRun = true
          throw new Error(
            `Status code: ${response.statusCode}, ${JSON.stringify(response?.body)}`
          )
        } else {
          await worker.setSessionValue('cryptogram', response.body.cryptogram)
        }
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })
  })
})
