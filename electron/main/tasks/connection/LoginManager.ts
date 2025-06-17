import * as constants from '#/constants'
import { createLogger } from '#/logger'
import { BrowserSessionManager } from './BrowserSessionManager'
import type { BrowserSession, StorageState } from './types'

export class LoginManager {
  private storageState: StorageState
  private logger = createLogger('登录模块')
  private loginConstants: LoginConstants

  constructor(private platform: LiveControlPlatform) {
    this.loginConstants = constants[platform].login
  }

  public async checkIfLoginRequired(session: BrowserSession): Promise<boolean> {
    this.logger.info('尝试前往中控台……')
    await this.visitLiveControlAndCheck(session)
    this.logger.debug(`当前页面: ${session.page.url()}`)

    const url = session.page.url()
    return this.loginConstants.loginUrlRegex.test(url)
  }

  public async ensureAuthenticated(session: BrowserSession, headless = true) {
    const needLogin = await this.checkIfLoginRequired(session)
    if (needLogin) {
      return await this.handleLogin(session, headless)
    }
    // 不需要登录
    return session
  }

  private async visitLiveControlAndCheck(
    session: BrowserSession,
  ): Promise<void> {
    if (this.platform === 'wxchannel') {
      const indexRegex = /platform\/?$/
      await Promise.race([
        session.page.waitForURL(this.loginConstants.loginUrlRegex, {
          timeout: 0,
        }),
        session.page.waitForSelector(
          this.loginConstants.isInLiveControlSelector,
          { timeout: 0 },
        ),
        session.page.waitForURL(indexRegex, { timeout: 0 }),
      ])

      if (indexRegex.test(session.page.url())) {
        throw new Error('视频号未开播的情况下无法连接到中控台，请先开播')
      }
    } else {
      await session.page.goto(this.loginConstants.liveControlUrl)
      await Promise.race([
        session.page.waitForURL(this.loginConstants.loginUrlRegex, {
          timeout: 0,
        }),
        session.page.waitForSelector(
          this.loginConstants.isInLiveControlSelector,
          { timeout: 0 },
        ),
      ])
    }
  }

  public async handleLogin(
    session: BrowserSession,
    headless: boolean,
  ): Promise<BrowserSession> {
    this.logger.info('需要登录，请在打开的浏览器中完成登录')

    if (headless) {
      return await this.handleHeadlessLogin(session)
    }
    return await this.handleVisibleLogin(session)
  }

  private async handleHeadlessLogin(_session: BrowserSession) {
    // 把原先的无头浏览器关了，开启有头浏览器
    await _session.browser.close()
    const sessionManager = BrowserSessionManager.getInstance()
    const visibleSession = await sessionManager.createSession(
      false,
      this.storageState,
    )

    // 导航到登录页面
    await visibleSession.page.goto(this.loginConstants.loginUrl)
    // 等待用户登录成功
    await visibleSession.page.waitForSelector(
      this.loginConstants.isLoggedInSelector,
      {
        timeout: 0,
      },
    )

    // 保存登录状态
    this.storageState = await visibleSession.context.storageState()
    this.logger.info('登录成功，将关闭当前浏览器，以无头模式重新启动，请稍等')

    // 关闭当前浏览器
    await visibleSession.browser.close()

    // 重新创建无头浏览器
    const newSession = await sessionManager.createSession(
      true,
      this.storageState,
    )

    return this.ensureAuthenticated(newSession, true)
  }

  private async handleVisibleLogin(session: BrowserSession) {
    await session.page.goto(this.loginConstants.loginUrl)
    await session.page.waitForSelector(this.loginConstants.isLoggedInSelector, {
      timeout: 0,
    })
    this.logger.info('登录完成，将跳转到中控台')
    // 抖音小店和小红书千帆登陆成功后都能直接跳转到中控台
    if (this.platform !== 'douyin' && this.platform !== 'redbook') {
      await session.page.goto(this.loginConstants.liveControlUrl)
    }
    // 保存状态
    this.storageState = await session.context.storageState()
    return session
  }
}
