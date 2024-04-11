const request = require('supertest')
const { before } = require('mocha')
const Worker = require('../helper/worker')
const Ajv = require('ajv')
const { expect } = require('chai')

const ajv = new Ajv()
const worker = new Worker()

const baseUrl = 'https://bv.api.vostok.bank'

describe.skip('Поповнення мобільного', function () {
  let token
  let password
  let payerCard
  let payerCardName
  let recipient
  let amount

  before(async () => {
    token = await worker.getSessionValue('token')
    const cardAccounts = await worker.getSessionValue('cardAccounts')
    const data = await worker.loadData()

    password = data.password
    payerCardName = data.payerCardName
    payerCard = await worker.findCardByName(cardAccounts, payerCardName)
    amount = await worker.randomAmount()
    recipient = data.recipientMobileMulti
  })

  this.beforeEach(async () => {
    await worker.waitForTime(1000)
  })

  describe('GET /mobilemulti/markup', function () {
    let response

    before(async () => {
      response = await request(baseUrl)
        .get('/payments/service/mobilemulti/markup')
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

  describe('POST /mobilemulti/setInput', function () {
    let response

    before(async () => {
      const sessionGuid = await worker.getSessionValue('sessionGuid')

      const challange = await worker.decrypt_v2()
      const encryptData = await worker.encryptAndSign_v2({
        challengePass: challange,
        controls: [
          {
            Name: 'PayeeId',
            Value: `card:${payerCard.cards[0].id}`
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
      response = await request(baseUrl)
        .post('/payments/v2/service/MobileMulti/setinput')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cryptogram: encryptData.cryptogram,
          sign: encryptData.sign,
          sessionGuid
        })

      const cryptogram = response.body.cryptogram

      await worker.setSessionValue('cryptogram', cryptogram)
    })

    it('should return 200 OK status code', function () {
      expect(response.statusCode).to.equal(200)
    })
  })

  describe('GET /mobilemulti/commission', function () {
    let response

    before(async () => {
      response = await request(baseUrl)
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

    before(async () => {
      const sessionGuid = await worker.getSessionValue('sessionGuid')

      const challange = await worker.decrypt_v2()
      const encryptData = await worker.encryptAndSign_v2({
        challengePass: challange,
        password
      })
      response = await request(baseUrl)
        .post('/payments/service/MobileMulti/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cryptogram: encryptData.cryptogram,
          sign: encryptData.sign,
          sessionGuid
        })

      const cryptogram = response.body.cryptogram

      await worker.setSessionValue('cryptogram', cryptogram)
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

  describe('POST saveAsTemplate', function () {
    let response

    before(async () => {
      const challange = await worker.decrypt_v2()
      const encryptData = await worker.encryptAndSign_v2({
        challengePass: challange
      })
      response = await request(baseUrl)
        .post('/payments/service/MobileMulti/saveAsTemplate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cryptogram: encryptData.cryptogram,
          sign: encryptData.sign,
          name: `Vodafone, ${recipient}`
        })

      const cryptogram = response.body.cryptogram

      await worker.setSessionValue('cryptogram', cryptogram)
    })

    it('should return 200 OK status code', function () {
      expect(response.statusCode).to.equal(200)
    })
  })
})

describe('Переказ з іншої картки', function () {
  let token
  let password
  let recipientCard
  let recipientCardName
  let amount

  before(async () => {
    token = await worker.getSessionValue('token')
    const cardAccounts = await worker.getSessionValue('cardAccounts')
    const data = await worker.loadData()

    password = data.password
    recipientCardName = data.payerCardName
    recipientCard = await worker.findCardByName(
      cardAccounts,
      recipientCardName
    )
    amount = await worker.randomAmount()
  })

  this.beforeEach(async () => {
    await worker.waitForTime(1000);
  })

  describe('БВР(вручну) => Власна БВ', function () {
    let payerCardNumber
    let payerCardExpiryDate
    let payerCardCvv

    before(async () => {
      const data = await worker.loadData()

      payerCardNumber = data.ownBVRCardNumber
      payerCardExpiryDate = data.ownBVRExpiryDate
      payerCardCvv = data.ownBVRCvv
    })

    describe('GET /p2p/markup', function () {
      let response

      before(async () => {
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

    describe('POST /p2p/setInput', function () {
      let response

      before(async function () {
        const sessionGuid = await worker.getSessionValue('sessionGuid')

        const challange = await worker.decrypt_v2()
        const encryptData = await worker.encryptAndSign_v2({
          challengePass: challange,
          cvv: payerCardCvv,
          expiryDate: payerCardExpiryDate
        })

        response = await request(baseUrl)
          .post('/payments/p2p/setInput')
          .set('Authorization', `Bearer ${token}`)
          .send({
            sign: encryptData.sign,
            cryptogram: encryptData.cryptogram,
            sessionGuid,
            payerId: `cardNumber:${payerCardNumber}`,
            recipientId: `cardNumber:${recipientCard.cards[0].cardNumber}`,
            amount
          })

        await worker.setSessionValue('cryptogram', response.body.cryptogram)
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })

    describe('GET /p2p/commission', function () {
      let response

      before(async () => {
        response = await request(baseUrl)
          .get('/payments/p2p/commission')
          .set('Authorization', `Bearer ${token}`)
          .send()
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })
    })

    describe('POST /p2p/confirm', function () {
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

        await worker.setSessionValue('cryptogram', response.body.cryptogram)
      })

      it('should return 200 OK status code', function () {
        expect(response.statusCode).to.equal(200)
      })

      it('should be ability to save card as template', function () {
        expect(response.body.hasCardToSave).to.equal(true)
        expect(response.body).to.has.property('cardToSave')
      })

      it('should have correct recipientContractId', function () {
        expect(response.body.recipientContractId).to.equal(
          recipientCard.contractId
        )
      })

      it("should have property 'operation'", function () {
        expect(response.body).to.has.property('operation')
      })

      it('operation should have correct title', function () {
        expect(response.body.operation.title).to.equal(
          'Переказ з картки на картку'
        )
      })

      it('operation should have correct subtitle', function () {
        expect(response.body.operation.subtitle).to.equal(
          'Переказ з картки на картку'
        )
      })

      it("operation should have status 'processing'", function () {
        expect(response.body.operation.status).to.equal('processing')
      })

      it('operation should have correct darkIcon', function () {
        expect(response.body.operation.darkIcon).to.equal(
          'https://content.vostok.bank/vostokApp/payment-history/categories/logos/TransferCard-Dark.png'
        )
      })

      it('operation should have correct lightIcon', function () {
        expect(response.body.operation.lightIcon).to.equal(
          'https://content.vostok.bank/vostokApp/payment-history/categories/logos/TransferCard-Light.png'
        )
      })
    })
  })
})
