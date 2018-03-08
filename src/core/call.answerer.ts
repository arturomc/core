import {ICall, AppConstructor, ReflectionKeys} from '../interfaces';
import {AppFactory, LifeCycle} from '../core';
/**
 * @class CallAnswerer
 * @author Jonathan Casarrubias
 * @license MIT
 * @description This class coordinates rpc calls between the broker
 * and the current application in order to send an answer back.
 */
export class CallAnswerer {
  /**
   * @property lifecycle
   * @description Default lifecycle, this can be override at
   * app level, module level or even at component level.
   */
  private lifecycle: LifeCycle = new LifeCycle();
  /**
   * @constructor
   * @param factory
   * @param AppClass
   */
  constructor(private factory: AppFactory, private AppClass: AppConstructor) {}
  /**
   * @method process
   * @param operation
   * @description This method will process an incoming call in order
   * to send back an answer.
   */
  async process(message: ICall): Promise<any> {
    return new Promise<any>(async (resolve, reject) => {
      console.log(
        `Onix callee app ${this.AppClass.name} got remote call procedure`,
      );
      console.log(
        `Onix callee app ${this.AppClass.name} processing rpc ${
          message.rpc
        } with call id ${message.uuid}`,
      );
      // Get segments from rpc endpoint
      const segments: string[] = message.rpc.split('.');
      // If segments are less than 2 or more than 4,
      // then this is an invalid call
      if (segments.length < 2 || segments.length > 4) {
        reject(new Error(`RPC Call is invalid ${message.rpc}`));
        return;
      }
      // Declare executable endpoint method and hooks references
      let scope,
        method: Function | null = null,
        mainHook: Function = () => null,
        slaveHook: Function | null = null;
      // If segments are exactly 2, then it is an application level call
      // Only god can do this type of calls.
      if (segments.length === 2) {
        scope = this.factory.app;
        method = this.factory.app[segments[1]];
        mainHook = this.lifecycle.onAppMethodCall;
      }
      // Module level call (System only, not exposed)
      if (segments.length > 2) {
        scope = this.factory.app[segments[1]];
        method = this.factory.app[segments[1]][segments[2]];
        const moduleConfig = Reflect.getMetadata(
          ReflectionKeys.MODULE_CONFIG,
          scope,
        );
        mainHook = moduleConfig.lifecycle
          ? moduleConfig.lifecycle
          : this.lifecycle.onModuleMethodCall;
      }
      // Component level method, RPC Exposed
      if (segments.length === 4) {
        scope = this.factory.app[segments[1]][segments[2]];
        method = this.factory.app[segments[1]][segments[2]][segments[3]];
        const componentConfig = Reflect.getMetadata(
          ReflectionKeys.COMPONENT_CONFIG,
          scope,
        );
        slaveHook = componentConfig.lifecycle
          ? componentConfig.lifecycle
          : this.lifecycle.onComponentMethodCall;
      }
      // Hey wait, but if the method doesn't exist?
      if (!method) {
        if (process.send)
          reject(new Error(`RPC Call is invalid ${message.rpc}`));
        return;
      }
      // Execute main hook, might be app/system or module level.
      const result = await mainHook(
        this.factory.app,
        message.request.metadata,
        async (): Promise<any> => {
          // If there is a custom component level hook for this call
          // then execute it first.
          if (slaveHook) {
            // Do whatever the developer defined in component config
            return slaveHook(
              this.factory.app,
              message.request.metadata,
              async (): Promise<any> => {
                // Ok cool, let me finis. lol (freaking genius)
                return method
                  ? method.call(scope, message.request.payload)
                  : null;
              },
            );
          } else {
            // Else just call the requested method now.
            return method ? method.call(scope, message.request.payload) : null;
          }
        },
      );
      // Log result
      console.log(
        `Onix callee app ${this.AppClass.name} sending rpc result`,
        result,
      );
      // Resolve promise
      resolve(result);
    });
  }
}
