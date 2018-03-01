'use strict';

var path = require('path');
var fs = require('fs');
var debug = require('debug')('portal-api:apis');
var yaml = require('js-yaml');
var request = require('request');

var utils = require('./utils');
var users = require('./users');
var subscriptions = require('./subscriptions');

var apis = require('express').Router();

var dao = require('../dao/dao');
var daoUtils = require('../dao/dao-utils');

// ===== ENDPOINTS =====

apis.get('/', function (req, res, next) {
    apis.getApis(req.app, res, req.apiUserId); //utils.loadApis(app);
});

apis.get('/desc', function (req, res, next) {
    apis.getDesc(req.app, res);
});

apis.get('/:apiId', function (req, res, next) {
    apis.getApi(req.app, res, req.apiUserId, req.params.apiId);
});

apis.get('/:apiId/config', function (req, res, next) {
    apis.getConfig(req.app, res, req.apiUserId, req.params.apiId);
});

apis.get('/:apiId/desc', function (req, res, next) {
    apis.getApiDesc(req.app, res, req.apiUserId, req.params.apiId);
});

apis.get('/:apiId/plans', function (req, res, next) {
    apis.getApiPlans(req.app, res, req.apiUserId, req.params.apiId);
});

apis.get('/:apiId/swagger', function (req, res, next) {
    apis.getSwagger(req.app, res, req.apiUserId, req.params.apiId);
});

apis.get('/:apiId/subscriptions', function (req, res, next) {
    apis.getSubscriptions(req.app, res, req.apiUserId, req.params.apiId);
});

// ===== IMPLEMENTATION =====

apis.getApis = function (app, res, loggedInUserId) {
    debug('getApis()');
    var apiList = utils.loadApis(app);

    // Set defaults
    var userGroups = [];
    var isAdmin = false;

    if (loggedInUserId) {
        users.loadUser(app, loggedInUserId, (err, userInfo) => {
            if (!userInfo)
                return res.status(403).jsonp({ message: 'Not allowed. User unknown.' });
            isAdmin = daoUtils.isUserAdmin(userInfo);
            if (!isAdmin)
                userGroups = userInfo.groups;
            return res.json(filterApiList(isAdmin, userGroups, apiList));
        });
    } else {
        return res.json(filterApiList(isAdmin, userGroups, apiList));
    }
};

function filterApiList(isAdmin, userGroups, apiList) {
    if (isAdmin)
        return apiList;

    var groupDict = {};
    for (let i = 0; i < userGroups.length; ++i) {
        groupDict[userGroups[i]] = true;
    }

    var filteredApiList = [];

    for (let i = 0; i < apiList.apis.length; ++i) {
        var api = apiList.apis[i];

        var addApi = false;
        if (!api.requiredGroup)
            addApi = true;
        else if (groupDict[api.requiredGroup])
            addApi = true;

        if (addApi)
            filteredApiList.push(api);
    }

    return { apis: filteredApiList };
}

apis.getDesc = function (app, res) {
    debug('getDesc()');
    var staticDir = utils.getStaticDir();
    var apisDir = path.join(staticDir, 'apis');
    var descFileName = path.join(apisDir, 'desc.md');

    if (!fs.existsSync(descFileName))
        return res.status(404).jsonp({ message: 'Not found.' });
    fs.readFile(descFileName, 'utf8', function (err, content) {
        if (!err) {
            res.setHeader('Content-Type', 'text/markdown');
            res.send(content);
        }
    });
};

apis.isValidApi = function (app, apiId) {
    debug('isValidApi()');
    var apiList = utils.loadApis(app);
    var apiIndex = -1;
    for (let i = 0; i < apiList.apis.length; ++i) {
        if (apiList.apis[i].id == apiId) {
            apiIndex = i;
            break;
        }
    }
    return (apiIndex >= 0);
};

apis.checkAccess = function (app, res, userId, apiId, callback) {
    debug('checkAccess(), userId: ' + userId + ', apiId: ' + apiId);
    if (!callback || typeof (callback) !== 'function')
        return callback(utils.makeError(500, 'checkAccess: callback is null or not a function'));
    var apiList = utils.loadApis(app);
    // Is it a valid API id?
    var apiIndex = -1;
    for (let i = 0; i < apiList.apis.length; ++i) {
        if (apiList.apis[i].id == apiId) {
            apiIndex = i;
            break;
        }
    }
    if (apiIndex < 0) {
        // Not, it's not.
        return callback(utils.makeError(404, 'Not found.'));
    }
    // Check for the user
    users.loadUser(app, userId, (err, userInfo) => {
        if (err)
            return callback(err);
        if (userId) {
            if (!userInfo) {
                return callback(utils.makeError(403, 'Not allowed. Invalid user.'));
            }
        }
        var selectedApi = apiList.apis[apiIndex];
        if (!selectedApi.requiredGroup) // Public
            return callback(null, true);

        // If we didn't have a logged in user, we're out
        if (!userInfo) {
            return callback(utils.makeError(403, 'Not allowed. API is restricted.'));
        }

        for (let i = 0; i < userInfo.groups.length; ++i) {
            if (userInfo.groups[i] == selectedApi.requiredGroup)
                return callback(null, true);
        }

        // We're still here... Admin the last resort
        if (daoUtils.isUserAdmin(userInfo))
            return callback(null, true);

        // Nope. Not allowed.
        return callback(utils.makeError(403, 'Not allowed. Insufficient rights.'));
    });
};

apis.getApi = function (app, res, loggedInUserId, apiId) {
    debug('getApi(): ' + apiId);
    apis.checkAccess(app, res, loggedInUserId, apiId, (err) => {
        if (err)
            return utils.fail(res, 403, 'Access denied', err);
        var apiList = utils.loadApis(app);
        var apiIndex = -1;
        for (var i = 0; i < apiList.apis.length; ++i) {
            if (apiList.apis[i].id == apiId) {
                apiIndex = i;
                break;
            }
        }
        res.json(apiList.apis[apiIndex]);
    });
};

apis.getApiPlans = function (app, res, loggedInUserId, apiId) {
    debug('getApiPlans(): ' + apiId);
    apis.checkAccess(app, res, loggedInUserId, apiId, (err) => {
        if (err)
            return utils.fail(res, 403, 'Access denied', err);
        var apiList = utils.loadApis(app);
        var apiIndex = -1;
        for (let i = 0; i < apiList.apis.length; ++i) {
            if (apiList.apis[i].id == apiId) {
                apiIndex = i;
                break;
            }
        }
        if (apiIndex < 0)
            return res.status(404).jsonp({ message: 'API not found:' + apiId });
        var selectedApi = apiList.apis[apiIndex];
        var allPlans = utils.loadPlans(app);
        var planMap = {};
        for (var i = 0; i < allPlans.plans.length; ++i)
            planMap[allPlans.plans[i].id] = allPlans.plans[i];
        var apiPlans = [];
        users.loadUser(app, loggedInUserId, (err, userInfo) => {
            if (err)
                return utils.fail(res, 500, 'could not load user', err);
            if (userInfo) {
                for (let i = 0; i < selectedApi.plans.length; ++i) {
                    var plan = planMap[selectedApi.plans[i]];
                    if (!plan.requiredGroup ||
                        (plan.requiredGroup && users.hasUserGroup(app, userInfo, plan.requiredGroup)))
                        apiPlans.push(plan);
                }
                res.json(apiPlans);
            } else {
                // No plans when not logged in.
                res.json([]);
            }
        });
    });
};

function loadApiConfig(app, apiId) {
    debug('loadApiConfig()');
    var staticDir = utils.getStaticDir();
    var configFileName = path.join(staticDir, 'apis', apiId, 'config.json');
    // Default to empty but valid json.
    var configJson = {};
    if (fs.existsSync(configFileName))
        configJson = JSON.parse(fs.readFileSync(configFileName, 'utf8'));
    else {
        // Check if it's an internal API
        configFileName = path.join(__dirname, 'internal_apis', apiId, 'config.json');
        if (fs.existsSync(configFileName))
            configJson = JSON.parse(fs.readFileSync(configFileName, 'utf8'));
    }
    utils.replaceEnvVars(configJson);
    return configJson;
}

apis.getConfig = function (app, res, loggedInUserId, apiId) {
    debug('getConfig(): ' + apiId);
    // Do we know this API?
    if (!apis.isValidApi(app, apiId))
        return utils.fail(res, 404, 'Not found: ' + apiId);
    apis.checkAccess(app, res, loggedInUserId, apiId, (err) => {
        if (err)
            return utils.fail(res, 403, 'Access denied', err);
        var configJson = loadApiConfig(app, apiId);
        var configReturn = configJson;
        users.isUserIdAdmin(app, loggedInUserId, (err, isAdmin) => {
            // Restrict what we return in case it's a non-admin user,
            // only return the request path, not the backend URL.
            if (!isAdmin) {
                configReturn = {
                    api: {
                        uris: configJson.api.uris
                    }
                };
            }
            res.json(configReturn);

        });
    });
};

apis.getApiDesc = function (app, res, loggedInUserId, apiId) {
    debug('getApiDesc(): ' + apiId);
    apis.checkAccess(app, res, loggedInUserId, apiId, (err) => {
        if (err)
            return utils.fail(res, 403, 'Access denied', err);
        var staticDir = utils.getStaticDir();
        var descFileName = path.join(staticDir, 'apis', apiId, 'desc.md');
        res.setHeader('Content-Type', 'text/markdown');
        // Even if there is no desc.md, default to empty 200 OK
        if (!fs.existsSync(descFileName)) {
            // Check internal APIs.
            descFileName = path.join(__dirname, 'internal_apis', apiId, 'desc.md');
            if (!fs.existsSync(descFileName))
                return res.send('');
        }
        res.send(fs.readFileSync(descFileName, 'utf8'));
    });
};

function injectParameter(swaggerJson, newParameter) {
    debug('injectParameter()');
    // Only with JSON and Javascript...
    for (var apiPathName in swaggerJson.paths) {
        if (apiPathName == '/oauth2/token')
            continue;
        var apiPath = swaggerJson.paths[apiPathName];
        for (var opName in apiPath) {
            var op = apiPath[opName];
            if (op.parameters) {
                // Don't do it twice
                var foundHeader = false;
                for (var i = 0; i < op.parameters.length; ++i) {
                    if (op.parameters[i].name == newParameter.name)
                        foundHeader = true;
                }
                if (!foundHeader)
                    op.parameters.push(newParameter);
            }
            else
                op.parameters = [newParameter];
        }
    }
}

function injectTokenEndpoint(globalSettings, swaggerJson) {
    debug('injectTokenEndpoint()');
    var paths = swaggerJson.paths;
    if (paths['/oauth2/token'])
        return;
    var useTags = false;
    if (swaggerJson.tags) {
        var oauthTag = swaggerJson.tags.find(function (tag) { return tag.name == "oauth2"; });
        if (!oauthTag) {
            swaggerJson.tags.push({
                name: "oauth2",
                description: "Acquiring Access Tokens"
            });
        }
        useTags = true;
    }
    var oauthPath = {
        post: {
            summary: 'Get an Access token for the API',
            description: '',
            consumes: ['application/x-www-form-urlencoded'],
            produces: ['application/json'],
            parameters: [
                {
                    description: "The grant type, 'client_credentials'",
                    name: "grant_type",
                    in: "formData",
                    required: true,
                    type: "string"
                },
                {
                    description: "Your Client ID; this is displayed on the API page for your application.",
                    name: "client_id",
                    in: "formData",
                    required: true,
                    type: "string"
                },
                {
                    description: "Your Client Secret; this is displayed on the API page for your application.",
                    name: "client_secret",
                    in: "formData",
                    required: true,
                    type: "string"
                }
            ],
            responses: {
                "200": {
                    description: 'An access token'
                }
            }
        }
    };
    if (useTags)
        oauthPath.post.tags = ["oauth2"];
    if (globalSettings.network.schema != "https") {
        oauthPath.post.parameters.push({
            name: "x-forwarded-proto",
            in: "header",
            description: "Only present when testing locally over http (not https). Removing makes Kong reject this request.",
            required: false,
            type: "string"
        });
    }
    paths['/oauth2/token'] = oauthPath;
}

// apis.getSwagger = function (app, res, loggedInUserId, apiId) {
//     debug('getSwagger(): ' + apiId);
//     if (apiId == '_portal')
//         return getPortalSwagger(app, res);
//     apis.checkAccess(app, res, loggedInUserId, apiId, (err) => {
//         if (err)
//             return utils.fail(res, 403, 'Access denied', err);
//         var staticDir = utils.getStaticDir();
//         var swaggerFileName = path.join(staticDir, 'apis', apiId, 'swagger.json');
//         if (!fs.existsSync(swaggerFileName)) {
//             // Check internal APIs
//             swaggerFileName = path.join(__dirname, 'internal_apis', apiId, 'swagger.json');
//             if (!fs.existsSync(swaggerFileName))
//                 return res.status(404).jsonp({ message: 'Not found. This is a bad sign; the Swagger definition must be there!' });
//         }

//         var globalSettings = utils.loadGlobals(app);
//         var configJson = loadApiConfig(app, apiId);

//         if (!configJson || !configJson.api || !configJson.api.uris || !configJson.api.uris.length)
//             return res.status(500).jsonp({ message: 'Invalid API configuration; does not contain uris array.' });
//         var requestPath = configJson.api.uris[0];

//         var apiList = utils.loadApis(app);
//         var apiInfo = apiList.apis.find(function (anApi) { return anApi.id == apiId; });

//         // Read it, we want to do stuff with it.
//         try {
//             var swaggerJson = require(swaggerFileName);

//             if (!apiInfo.auth || apiInfo.auth == "key-auth") {
//                 // Inject a new parameter for the API key.
//                 // globalSettings.api.headerName,
//                 var apikeyParam = {
//                     in: "header",
//                     name: globalSettings.api.headerName,
//                     required: false,
//                     type: "string",
//                     description: "API Key to authorize with API Gateway"
//                 };
//                 injectParameter(swaggerJson, apikeyParam);
//             } else if (apiInfo.auth == "oauth2") {
//                 debug('Injecting OAuth2');
//                 var authParam = {
//                     in: "header",
//                     name: "Authorization",
//                     required: true,
//                     type: "string",
//                     description: 'The OAuth2 Bearer token, "Bearer ..."'
//                 };
//                 injectParameter(swaggerJson, authParam);

//                 injectTokenEndpoint(globalSettings, swaggerJson);
//             }

//             swaggerJson.host = globalSettings.network.apiHost;
//             swaggerJson.basePath = requestPath;
//             swaggerJson.schemes = [globalSettings.network.schema];
//             //swaggerJson.schemes = ["http"];

//             // OK, that worked
//             return res.json(swaggerJson);
//         } catch (err) {
//             return res.status(500).jsonp({ message: 'Internal Server Error! Could not parse Swagger, check your files.' + err });
//         }
//     });
// }

// Looks like this:
// {
//     "<apiId>": {
//         "date": <date of read>,
//         "valid": true/false,
//         "swagger": <swagger JSON document>
//     }
// }    
const _swaggerMap = {};
function resolveSwagger(globalSettings, apiInfo, requestPath, fileName, callback) {
    debug('resolveSwagger(' + fileName + ')');
    const FIVE_MINUTES = 5 * 60 * 1000;
    if (_swaggerMap[apiInfo.id]) {
        const apiData = _swaggerMap[apiInfo.id];
        if ((new Date()) - apiData.date < FIVE_MINUTES) {
            // We'll return the cached data
            if (apiData.valid)
                return callback(null, apiData.swagger);
            // Invalid cached data
            return callback(new Error('Invalid swagger data for API ' + apiId));
        }
        // We'll refresh the data, fall past
    }

    function injectAuthAndReturn(swaggerJson) {
        if (!apiInfo.auth || apiInfo.auth == "key-auth") {
            // Inject a new parameter for the API key.
            // globalSettings.api.headerName,
            var apikeyParam = {
                in: "header",
                name: globalSettings.api.headerName,
                required: false,
                type: "string",
                description: "API Key to authorize with API Gateway"
            };
            injectParameter(swaggerJson, apikeyParam);
        } else if (apiInfo.auth == "oauth2") {
            debug('Injecting OAuth2');
            var authParam = {
                in: "header",
                name: "Authorization",
                required: true,
                type: "string",
                description: 'The OAuth2 Bearer token, "Bearer ..."'
            };
            injectParameter(swaggerJson, authParam);
            injectTokenEndpoint(globalSettings, swaggerJson);
        }

        swaggerJson.host = globalSettings.network.apiHost;
        swaggerJson.basePath = requestPath;
        swaggerJson.schemes = [globalSettings.network.schema];

        // Cache it for a while
        _swaggerMap[apiInfo.id] = {
            date: new Date(),
            valid: true,
            swagger: swaggerJson
        };

        return callback(null, swaggerJson);
    }

    try {
        const swaggerText = fs.readFileSync(fileName, 'utf8');
        const rawSwagger = JSON.parse(swaggerText);
        if (rawSwagger.swagger) { // version, e.g. "2.0"
            return injectAuthAndReturn(rawSwagger);
        } else if (rawSwagger.href) {
            // We have a href property inside the Swagger, we will try to retrieve it
            // from an URL here.
            utils.replaceEnvVars(rawSwagger);
            // We must be able to just get this thing
            request.get({
                url: rawSwagger.href
            }, (err, apiRes, apiBody) => {
                if (err)
                    return callback(err);
                try {
                    const rawSwaggerRemote = utils.getJson(apiBody);
                    return injectAuthAndReturn(rawSwaggerRemote);
                } catch (err) {
                    return callback(new Error('Could not parse remote Swagger from ' + rawSwagger.href));
                }
            });
        } else {
            // Bad case.
            throw new Error('The swagger file does neither contain a "swagger" nor a "href" property: ' + fileName);
        }
    } catch (err) {
        // Cache failure for five minutes
        _swaggerMap[apiInfo.id] = {
            date: new Date(),
            valid: false
        };
        return callback(err);
    }
}

apis.getSwagger = function (app, res, loggedInUserId, apiId) {
    debug('getSwagger(): ' + apiId);
    if (apiId == '_portal')
        return getPortalSwagger(app, res);
    apis.checkAccess(app, res, loggedInUserId, apiId, (err) => {
        if (err)
            return utils.fail(res, 403, 'Access denied', err);
        var staticDir = utils.getStaticDir();
        var swaggerFileName = path.join(staticDir, 'apis', apiId, 'swagger.json');
        if (!fs.existsSync(swaggerFileName)) {
            // Check internal APIs
            swaggerFileName = path.join(__dirname, 'internal_apis', apiId, 'swagger.json');
            if (!fs.existsSync(swaggerFileName))
                return res.status(404).jsonp({ message: 'Not found. This is a bad sign; the Swagger definition must be there!' });
        }

        var globalSettings = utils.loadGlobals(app);
        var configJson = loadApiConfig(app, apiId);

        if (!configJson || !configJson.api || !configJson.api.uris || !configJson.api.uris.length)
            return res.status(500).jsonp({ message: 'Invalid API configuration; does not contain uris array.' });
        var requestPath = configJson.api.uris[0];

        var apiList = utils.loadApis(app);
        var apiInfo = apiList.apis.find(function (anApi) { return anApi.id == apiId; });

        // Read it, we want to do stuff with it.
        // resolveSwagger might read directly from the swagger file, or, if the
        // swagger JSON contains a href property, get it from a remote location.
        resolveSwagger(globalSettings, apiInfo, requestPath, swaggerFileName, (err, swaggerJson) => {
            if (err) {
                return res.status(500).json({
                    message: 'Could not resolve the Swagger JSON file, an error occurred.',
                    error: err
                });
            }
            return res.json(swaggerJson);
        });
    });
};

apis._portalSwagger = null;
function getPortalSwagger(app, res) {
    try {
        if (!apis._portalSwagger) {
            apis._portalSwagger = initPortalSwagger(app);
        }

        return res.json(apis._portalSwagger);
    } catch (err) {
        console.error(err.message);
        console.error(err.stack);
        return res.status(500).json({ message: err.message });
    }
}

function initPortalSwagger(app) {
    var swaggerFileName = path.join(__dirname, '..', 'swagger', 'portal-api-public.yaml');
    if (!fs.existsSync(swaggerFileName))
        throw new Error('File not found: ' + swaggerFileName);

    var swaggerYaml = yaml.safeLoad(fs.readFileSync(swaggerFileName, 'utf8'));
    injectParameter(swaggerYaml, {
        in: "header",
        name: "Authorization",
        required: true,
        type: "string",
        desc: 'The OAuth2 Bearer token, "Bearer ..."'
    });
    var globalSettings = utils.loadGlobals(app);
    injectTokenEndpoint(globalSettings, swaggerYaml);

    swaggerYaml.host = globalSettings.network.apiHost;
    swaggerYaml.basePath = '/portal-api/v1';
    swaggerYaml.schemes = [globalSettings.network.schema];

    return swaggerYaml;
}

apis.getSubscriptions = function (app, res, loggedInUserId, apiId) {
    debug('getSubscriptions() ' + apiId);
    // TODO: Paging parameters
    const limit = 0;
    const offset = 0;
    users.loadUser(app, loggedInUserId, (err, userInfo) => {
        if (err)
            return utils.fail(res, 500, 'getSubscriptions: Could not load user', err);
        if (!userInfo ||
            !userInfo.admin) {
            return utils.fail(res, 403, 'Not Allowed. Only Admins can get subscriptions for an API.');
        }
        dao.subscriptions.getByApi(apiId, offset, limit, (err, apiSubs) => {
            if (err)
                return utils.fail(res, 500, 'api.getSubscriptions: DAO failed to get subscriptions per API', err);
            if (apiSubs) {
                return res.json(apiSubs);
            }
            utils.fail(res, 404, 'Not Found.');
        });
    });
};

module.exports = apis;
