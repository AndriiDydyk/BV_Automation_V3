const request = require('supertest')
const { before } = require('mocha')
const Worker = require('../helper/worker')
const CryptoManager = require('../helper/cryptoManager')
const Ajv = require('ajv')
const { expect } = require('chai')

const ajv = new Ajv()
const worker = new Worker()
const cryptoManager = new CryptoManager()

describe('', function () {
  let host
  let device
  let phoneNumber
  let otp
  let password

  before(async () => {
    const env = await worker.loadEnvironments()

    host = env.test.host
    phoneNumber = env.test.phoneNumber
    otp = env.test.otp
    password = env.test.password
    device = env.test.device
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
})
