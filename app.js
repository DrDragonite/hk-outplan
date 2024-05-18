const express = require('express');
const OpenAI = require("openai");
const morgan = require("morgan");
const multer = require("multer");
const upload = multer();
const rateLimit = require('express-rate-limit');
const { find } = require('geo-tz')
require("dotenv").config();


/* -------------------------------------------------------------------------- */
/*                           Express initialization                           */
/* -------------------------------------------------------------------------- */

// init webserver
const app = express();
const port = 10117;

// make whitelist
const checkWL = ip => {
	const whitelist = ["::1", "127.0.0.1", "10.0.2.142", "10.0.2.137", "10.0.3.114", "10.0.2.138"]; // local, local, ja, marek, samo, filip
	return Boolean(whitelist.find(addr => ip.includes(addr)));
};

// webserver config
app.use(morgan("tiny"));
app.set('view engine', 'pug'); // set pug as renderer
app.set('views', './gui'); // locate template folder
app.use(rateLimit({
	windowMs: 60 * 1000,
	limit: 1,
	standardHeaders: 'draft-7',
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
	skip: req => {
		if (checkWL(req.ip))
			return true;
		if (req.path == "/")
			return true;
		return false;
	}
}));
app.use('/media', express.static('./media')); // serve static files from '/media' endpoint

/* -------------------------------------------------------------------------- */
/*                            OpenAI initialization                           */
/* -------------------------------------------------------------------------- */

// openai init
const openai = new OpenAI({
	apiKey: process.env['OPENAI_API_KEY'],
	maxRetries: 0,
	timeout: 5 * 1000,
});

const SYS_MSG_WO_CLOTHES = `
suggest appropriate clothing for my trip based on the information I provide

keep all weather, location and activity information IMPLIED
feels-like temperature is more important than actual temperature
always suggest clothes for body, for the legs and what to shoes wear - never suggest only for body or only for legs

under any circumstances do not mention activity data
under any circumstances do not mention location data
under any circumstances do not mention weather data
don't suggest umbrella under high winds
suggest thermal clothing in low temperatures ONLY
recommend short trousers in higher temperatures
never recommend short trousers in low temperatures

answer format: Short sentence about clothes
`.trim();

const SYS_MSG_W_CLOTHES = `
recommend what extra clothes should I wear for my trip in a short sentence.
I provide details about my trip in the message.

do not provide suggestions regarding the categories I have already chosen - recommend something else

under any circumstances do not mention activity data
under any circumstances do not mention location data
under any circumstances do not mention weather data
don't suggest umbrella under high winds
suggest thermal clothing in low temperatures ONLY
recommend short trousers in higher temperatures
never recommend short trousers in low temperatures
`.trim();

const SYS_MSG_WARNING = `
mention potentially dangerous precautions related to weather and location for my trip.
trip details are provided in the user message

under any circumstances do not mention location data
under any circumstances do not mention weather data
do not provide clothes suggestions or precautions related to the clothing

answer format: Short sentence about precautions
`.trim();

const SYS_MSG_ALERTS = `
summarize the given text in english language only.
make it as short as possible but do not leave out any important details.
no matter what use maximum of 25 words.
`.trim();

// openai.chat.completions.create({
// 	messages: [{ role: 'user', content: 'Say this is a test' }],
// 	model: 'gpt-3.5-turbo',
// }).then(console.log);

/* -------------------------------------------------------------------------- */
/*                                 Router code                                */
/* -------------------------------------------------------------------------- */

// index page
app.get('/', async (req, res) => {
	// if (!checkWL(req.ip))
	// 	return;
	try {
		await fetch("http://127.0.0.1:11434/")
		res.render('index', {maxDays: process.env.FORECAST_MAX_DAYS, ollama: "ready"});
	} catch {
		try {
			await fetch("https://gitlab.com/api/v4/projects/57950563/trigger/pipeline?token=" + process.env.GITLAB_RUNNER_TRIGGER_TOKEN + "&ref=master&variables[RUNNER_SCRIPT_TIMEOUT]=1h", {method: "POST"})
			res.render('index', {maxDays: process.env.FORECAST_MAX_DAYS, ollama: "started"});
		} catch {
			console.log('pipeline start failed')
			res.render('index', {maxDays: process.env.FORECAST_MAX_DAYS, ollama: "error"});
		}
	}
});

function chunkArray(array, n) {
	const chunks = [];
	for (let i = 0; i < array.length; i += n) {
		chunks.push(array.slice(i, i + n));
	}
	return chunks;
}

app.post('/advice', upload.array('photos'), async (req, res) => {
	const NOW = new Date();
	NOW.setMinutes(NOW.getMinutes() - 1); // account for request delay

	const MAX_DATE = new Date();
	MAX_DATE.setDate(NOW.getDate() + process.env.FORECAST_MAX_DAYS);
	
	// meteo params
	const lat = Number(req.body?.lat);
	if (isNaN(lat) || lat < -90 || lat > 90)
		return res.status(400).send("Invalid latitude");

	const lon = Number(req.body?.lon);
	if (isNaN(lon) || lon < -180 || lon > 180)
		return res.status(400).send("Invalid longitude");

	const startDate = Number(req.body.startDate);
	if (isNaN(startDate) || startDate < NOW.valueOf() || startDate > MAX_DATE.valueOf())
		return res.status(400).send("Invalid starting date");

	const endDate = Number(req.body.endDate);
	if (isNaN(endDate) || endDate < NOW.valueOf() || endDate > MAX_DATE.valueOf())
		return res.status(400).send("Invalid end date");

	if (startDate > endDate)
		return res.status(400).send("Start date must be before end date");

	// get additional info for ChatGPT
	const placeClass = req.body.class;
	const placeType = req.body.type;
	const activity = req.body.activity;

	const isoDates = [];

	const sampleCount = process.env.METEO_SAMPLES;
	const timeRange = endDate - startDate;
	const intervalPiece = timeRange / sampleCount;
	if (intervalPiece < 60 * 60 * 1000) {
		for (let d = startDate; d <= endDate; d += 60 * 60 * 1000) {
			isoDates.push(new Date(d).toISOString());
		}
	} else {
		for (let i = 0; i < sampleCount; i++) {
			isoDates.push(new Date(startDate + i*intervalPiece).toISOString());
		}
	}

	// get data from meteo api
	let meteoJSON;
	try {
		const resp = await fetch(`https://climathon.iblsoft.com/data/gfs-0.5deg/edr/collections/single-layer/position?coords=POINT(${lon} ${lat})&parameter-name=temperature_gnd-surf,snow-depth_gnd-surf,percent-frozen-precipitation_gnd-surf,wind-speed-gust_gnd-surf,pressure_gnd-surf,total-cloud-cover_atmosphere,visibility_gnd-surf,ice-cover_gnd-surf,relative-humidity_0-isoterm&datetime=${isoDates.join(",")}&f=CoverageJSON`);
		meteoJSON = await resp.json();
	} catch {
		console.log("Meteo request 1 failed");
		return res.sendStatus(500);
	}

	let apparentTempJSON;
	try {
		const resp = await fetch(`https://climathon.iblsoft.com/data/gfs-0.5deg/edr/collections/height-above-ground_4/position?coords=POINT(${lon} ${lat})&parameter-name=apparent-temperature,dewpoint-temperature&datetime=${isoDates.join(",")}&f=CoverageJSON`);
		apparentTempJSON = await resp.json();
	} catch {
		console.log("Meteo request 1 failed");
		return res.sendStatus(500);
	}

	const utcOffset = Number(req.body.utcOffset);


	// split meteo data into days
	const paramCount = Object.keys(meteoJSON.parameters).length
	const samples = chunkArray(meteoJSON.coverages, paramCount); // should separate into days by `domain.time`

	const apparentTempParamCount = Object.keys(apparentTempJSON.parameters).length
	console.log(apparentTempJSON.coverages)
	const apparentTempSamples = chunkArray(apparentTempJSON.coverages, apparentTempParamCount); // should separate into days by `domain.time`


	// calculate interval for calculating perticipation
	const startDateMidnight = (new Date(startDate));
	startDateMidnight.setHours(0);
	startDateMidnight.setMinutes(-utcOffset);
	startDateMidnight.setSeconds(0);
	startDateMidnight.setMilliseconds(0);
	const isoDayStart = startDateMidnight.toISOString();

	const endDateMidnight = (new Date(endDate));
	endDateMidnight.setHours(24 - 6);
	endDateMidnight.setMinutes(-utcOffset);
	endDateMidnight.setSeconds(0);
	endDateMidnight.setMilliseconds(0);
	const isoDayEnd = endDateMidnight.toISOString(); // +18 hours because of 6h intervals

	// get rain amounts
	let rainJSON;
	try {
		const resp = await fetch(`https://climathon.iblsoft.com/data/gefs-0.25deg/edr/collections/single-level_2/position?coords=POINT(${lon} ${lat})&parameter-name=total-precipitation_gnd-surf_positively-perturbed_stat:acc/PT6H&datetime=${isoDayStart}/${isoDayEnd}&f=CoverageJSON`);
		rainJSON = await resp.json();
	} catch {
		console.log("Meteo request 2 failed");
		return res.sendStatus(500);
	}

	// calculate rain percentage from rain amounts
	const coverageCount = rainJSON.coverages.length;
	let rainPercent = 0;
	for (var i = 0; i < coverageCount; i++) {
		const nazov = "total-precipitation_gnd-surf_positively-perturbed_stat:acc/PT6H_mem-" + (Math.floor(i / (coverageCount / 30)) + 1);
		rainPercent += rainJSON.coverages[i].ranges[nazov].values[0] > 0.1;
	}
	rainPercent /= coverageCount;
	let frozenPercipitation = null;

	const minmaxData = {
		"temperature": { min: null, max: null },
		"wind_gust": { min: null, max: null },
		"pressure": { min: null, max: null },
		"snow_depth": { min: null, max: null },
		"cloud_coverage": { min: null, max: null },
		"visibility": { min: null, max: null },
		"ice_cover": { min: null, max: null },
		"humidity": { min: null, max: null },
		"apparent_temp": { min: null, max: null },
		"dew_point": { min: null, max: null }
	};

	for (let sample of samples) {
		const getParam = name => Object.entries(meteoJSON.parameters).findIndex(e => e[0] == name);
		const getEntry = param => ({ value: Object.values(sample[getParam(param)]?.ranges || {}).at(0)?.values.at(0), unit: meteoJSON.parameters[getParam(param)]?.unit?.symbol });
		const v = (val, def) => val === null ? def : (isNaN(val) ? val : Number(val));
		const minmax = (key, param) => {
			let value = getEntry(param).value;
			minmaxData[key] = {
				min: Math.min(v(minmaxData[key].min, value), value),
				max: Math.max(v(minmaxData[key].max, value), value)
			}
		};

		// collect data
		minmax("temperature", "temperature_gnd-surf");
		minmax("wind_gust", "wind-speed-gust_gnd-surf");
		minmax("pressure", "pressure_gnd-surf");
		minmax("snow_depth", "snow-depth_gnd-surf");
		minmax("cloud_coverage", "total-cloud-cover_atmosphere");
		minmax("visibility", "visibility_gnd-surf");
		minmax("ice_cover", "ice-cover_gnd-surf");
		minmax("humidity", "relative-humidity_0-isoterm");		

		const fp = getEntry("percent-frozen-precipitation_gnd-surf").value;
		frozenPercipitation = Math.max(frozenPercipitation || fp, fp);
	}

	for (let sample of apparentTempSamples) {
		const getParam = name => Object.entries(apparentTempJSON.parameters).findIndex(e => e[0] == name);
		const getEntry = param => ({ value: Object.values(sample[getParam(param)]?.ranges || {}).at(0)?.values.at(0), unit: apparentTempJSON.parameters[getParam(param)]?.unit?.symbol });
		const v = (val, def) => val === null ? def : (isNaN(val) ? val : Number(val));
		const minmax = (key, param) => {
			let value = getEntry(param).value;
			minmaxData[key] = {
				min: Math.min(v(minmaxData[key].min, value), value),
				max: Math.max(v(minmaxData[key].max, value), value)
			}
		};

		minmax("apparent_temp", "apparent-temperature")
		minmax("dew_point", "dewpoint-temperature")
	}

	// helper functions for formatting data
	const clamp = (val, min = 0, max = 1) => Math.min(max, Math.max(min, val));
	const normalize = (val, max = 100) => clamp(val, 0, max) / max;
	const valsplit = (val, namesSplit, nameEmpty = undefined, treshold = 0.1) => val > treshold ? namesSplit[Math.floor(val / (1 / namesSplit.length + 0.01))] : (typeof nameEmpty !== undefined ? nameEmpty : namesSplit[0]);
	const formatMm = (minmax, map = v=>v) => map(minmax.max) !== map(minmax.min) ? [minmax.min, minmax.max].filter(x => x !== null && x !== undefined).map(map).join(" to ") : map(minmax.max);

	// amount and type of precipitation
	const precipitation = valsplit(clamp(rainPercent), ["low", "medium", "high"], "no");
	const perticipationType = valsplit(normalize(frozenPercipitation), ["rain with snow", "snow"], "rain");

	// pressure is low, medium or high
	let pressureTypeMin = "low";
	if (minmaxData.pressure.min > 1002.5 && minmaxData.pressure.min <= 1031.5) {
		pressureTypeMin = "medium";
	} else if (minmaxData.pressure.min > 1031.5) {
		pressureTypeMin = "high";
	}
	let pressureTypeMax = "low";
	if (minmaxData.pressure.max > 1002.5 && minmaxData.pressure.max <= 1031.5) {
		pressureTypeMax = "medium";
	} else if (minmaxData.pressure.max > 1031.5) {
		pressureTypeMax = "high";
	}

	// amount of cloud coverage
	const cloudCoverageTypeMin = valsplit(normalize(minmaxData.cloud_coverage.min), ["clear", "partial", "overcast", "thick"])
	const cloudCoverageTypeMax = valsplit(normalize(minmaxData.cloud_coverage.max), ["clear", "partial", "overcast", "thick"])

	// visibility in haze
	const fogTypeMin = valsplit(normalize(minmaxData.visibility.min, 50_000), [null, null, null, "haze", "light fog", "thick fog"]);
	const fogTypeMax = valsplit(normalize(minmaxData.visibility.max, 50_000), [null, null, null, "haze", "light fog", "thick fog"]);

	// low medium or high humidity
	const humidityTypeMin = valsplit(normalize(minmaxData.humidity.min), ["low", "medium", "high", "very high"]);
	const humidityTypeMax = valsplit(normalize(minmaxData.humidity.max), ["low", "medium", "high", "very high"]);

	// compile data into readable format for ChatGPT
	let data = {
		"Temperature": formatMm(minmaxData.temperature, v=>Math.floor(v-273.15)) + " degrees celsius",
		"Apparent temperature": formatMm(minmaxData.apparent_temp, v=>Math.floor(v-273.15)) + " degrees celsius",
		"Precipitation": `${precipitation} chance of ${perticipationType}`,
		"Wind gusts": formatMm(minmaxData.wind_gust, Math.floor) + " m/s",
		"Pressure": formatMm({"min": pressureTypeMin, "max": pressureTypeMax}),
		"Snow depth": (minmaxData.snow_depth.max || null) && minmaxData.snow_depth.max + " m",
		"Cloud coverage": formatMm({"min": cloudCoverageTypeMin, "max": cloudCoverageTypeMax}),
		"Fog type": formatMm({ "min": fogTypeMin, "max": fogTypeMax }),
		"Ice cover": minmaxData.ice_cover.max ? "yes" : null,
		"Humidity": formatMm({"min": humidityTypeMin, "max": humidityTypeMax}),
		"Dew point temperature": formatMm(minmaxData.dew_point, v=>Math.floor(v-273.15)) + " degrees celsius",
		"Location": [placeClass, placeType].filter(x => x).join(", "),
		"Activity": activity,
	}

	// filter out invalid and hidden values
	data = Object.entries(data).filter(e => !(e[1] === null || e[1] === undefined || e[1] === ""));

	const contentMsg = data.map(x => x.join(": ")).join("\n");

	console.log(contentMsg);

	let gptText;

	const mimetypes = ["image/png", "image/jpg", "image/jpeg"]
	if (10 >= req.files.length && req.files.length > 0) {
		if (req.files.every((e) => mimetypes.includes(e.mimetype) && e.size < 5000000)) {
			let modelAnswer;
			const formData = new FormData()
			for (let i = 0; i < req.files.length; i++) {
				formData.append("photos", new Blob([req.files[i].buffer], {type: req.files[i].mimetype}), req.files[i].originalname)
			}
			try {
				const resp = await fetch("http://localhost:5000/upload", {
					method: "POST",
					body: formData
				});
				modelAnswer = await resp.text();
			} catch {
				console.log("Model request failed");
				return res.sendStatus(500);
			}
			data['Chosen clothes'] = modelAnswer


			let response;
			try {
				const llmResponse = await fetch("http://127.0.0.1:11434/api/generate", {method: "POST", body: JSON.stringify({
					model: "nous-hermes2:10.7b",
					prompt: contentMsg,
					stream: false,
					system: SYS_MSG_W_CLOTHES,
					options: {
						temperature: 0.5,
						num_ctx: 4096,
						mirostat_tau: 1.0,
						num_predict: 64,
						top_k: 20,
						top_p: 0.3,
						tfs_z: 2.0
					}
				})})

				response = await llmResponse.json()
				gptText = response.response
			} catch {
				gptText = "LLM runner currently unavailable"
			}
			
		} else {
			res.send("Wrong file")
		}
	} else {
		//query ChatGPT to generate description
		let response;
		try {
			const llmResponse = await fetch("http://127.0.0.1:11434/api/generate", {method: "POST", body: JSON.stringify({
				model: "nous-hermes2:10.7b",
				prompt: contentMsg,
				stream: false,
				system: SYS_MSG_WO_CLOTHES,
				options: {
					temperature: 0.5,
					num_ctx: 4096,
					mirostat_tau: 1.0,
					num_predict: 64,
					top_k: 20,
					top_p: 0.3,
					tfs_z: 2.0
				}
			})})

			response = await llmResponse.json()
			gptText = response.response
		} catch {
			gptText = "LLM runner currently unavailable"
		}
	}

	let warningResponse;
	let warningText;
	try {
		const llmResponse = await fetch("http://127.0.0.1:11434/api/generate", {method: "POST", body: JSON.stringify({
			model: "nous-hermes2:10.7b",
			prompt: contentMsg,
			stream: false,
			system: SYS_MSG_WARNING,
			options: {
				temperature: 0.5,
				num_ctx: 4096,
				mirostat_tau: 1.0,
				num_predict: 64,
				top_k: 20,
				top_p: 0.3,
				tfs_z: 2.0
			}
		})})

		warningResponse = await llmResponse.json()
		warningText = warningResponse.response;
	} catch {
		console.log("LLM runner currently unavailable")
	}
	console.log(warningText, "!!!!!")
	res.send(gptText + "\n" + warningText);
})


app.post('/weather', async (req, res) => {
	const NOW = new Date();
	NOW.setMinutes(NOW.getMinutes() - 1); // account for request delay

	const MAX_DATE = new Date();
	MAX_DATE.setDate(NOW.getDate() + process.env.FORECAST_MAX_DAYS);
	
	// meteo params
	const lat = Number(req.query?.lat);
	if (isNaN(lat) || lat < -90 || lat > 90)
		return res.status(400).send("Invalid latitude");

	const lon = Number(req.query?.lon);
	if (isNaN(lon) || lon < -180 || lon > 180)
		return res.status(400).send("Invalid longitude");

	const startDate = Number(req.query.startDate);
	if (isNaN(startDate) || startDate < NOW.valueOf() || startDate > MAX_DATE.valueOf())
		return res.status(400).send("Invalid starting date");

	const endDate = Number(req.query.endDate);
	if (isNaN(endDate) || endDate < NOW.valueOf() || endDate > MAX_DATE.valueOf())
		return res.status(400).send("Invalid end date");

	if (startDate > endDate)
		return res.status(400).send("Start date must be before end date");

	const utcOffsetLocal = Number(req.query.utcOffset);

	
	const getOffset = (timeZone) => {
		const timeZoneName = Intl.DateTimeFormat("ia", {
		  	timeZoneName: "short",
		  	timeZone,
		})
		  	.formatToParts()
		  	.find((i) => i.type === "timeZoneName").value;
		const offset = timeZoneName.slice(3);
		if (!offset) return 0;
	  
		const matchData = offset.match(/([+-])(\d+)(?::(\d+))?/);
		if (!matchData) throw `cannot parse timezone name: ${timeZoneName}`;
	  
		const [, sign, hour, minute] = matchData;
		let result = parseInt(hour) * 60;
		if (sign === "+") result *= -1;
		if (minute) result += parseInt(minute);
	  
		return result;
	};
	const utcOffset = getOffset(find(lat, lon))

	const isoDates = [];
	for (let d = startDate; d <= endDate; d += 24 * 60 * 60 * 1000) {
		let utcCurrent = new Date(d)
		let minutesSinceMidnight = utcCurrent.getHours()*60+utcCurrent.getMinutes()+utcOffsetLocal
		

	

		let midnight = new Date(d)
		midnight.setHours(27);
		midnight.setMinutes(utcOffset-utcOffsetLocal);
		midnight.setSeconds(0);
		midnight.setMilliseconds(0);

		let noon = new Date(d)
		noon.setHours(15);
		noon.setMinutes(utcOffset-utcOffsetLocal+30);
		noon.setSeconds(0);
		noon.setMilliseconds(0);
		
		if ((24*60 - minutesSinceMidnight) < -utcOffset) {
			midnight.setDate(midnight.getDate() + 1)
			noon.setDate(noon.getDate() + 1)
		}
		
		isoDates.push(midnight.toISOString());
		isoDates.push(noon.toISOString());
	}
	
	
	// get data from meteo api
	let meteoJSON;
	try {
		const resp = await fetch(`https://climathon.iblsoft.com/data/gfs-0.5deg/edr/collections/single-layer/position?coords=POINT(${lon} ${lat})&parameter-name=temperature_gnd-surf,total-cloud-cover_atmosphere&datetime=${isoDates.join(",")}&f=CoverageJSON`);
		meteoJSON = await resp.json();
	} catch {
		console.log("Meteo request 1 failed");
		return res.sendStatus(500);
	}

	// split meteo data into days
	const paramCount = Object.keys(meteoJSON.parameters).length
	const samples = chunkArray(meteoJSON.coverages, paramCount); // should separate into days by `domain.time`

	

	const days = new Array(samples.length/2).fill().map(()=>Object.fromEntries(Object.entries({"name": null, "dayTemp": null, "nightTemp": null, "cloudCoverage": null, "precipitation": null})));
	for (let i = 0; i < samples.length; i++) {
		const sample = samples[i];
		const dayI = Math.floor(i / 2);
		
		const getParam = name => Object.entries(meteoJSON.parameters).findIndex(e => e[0] == name);
		const getEntry = param => ({ value: Object.values(sample[getParam(param)]?.ranges || {}).at(0).values.at(0), unit: meteoJSON.parameters[getParam(param)]?.unit?.symbol });
		
		const weekday = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

		if (i%2 == 0) {
			days[dayI].name = weekday[new Date(isoDates[i]).getDay() || 0]
			days[dayI].dayTemp = Math.floor(getEntry("temperature_gnd-surf").value-273.15)
			days[dayI].cloudCoverage = Math.floor(getEntry("total-cloud-cover_atmosphere").value)

			// calculate interval for calculating perticipation
			let startDateMidnight = (new Date(isoDates[i]));
			startDateMidnight.setHours(0);
			startDateMidnight.setMinutes(-utcOffset);
			startDateMidnight.setSeconds(0);
			startDateMidnight.setMilliseconds(0);
			let isoDayStart = startDateMidnight.toISOString();

			let endDateMidnight = (new Date(isoDates[i]));
			endDateMidnight.setHours(24 - 6);
			endDateMidnight.setMinutes(-utcOffset);
			endDateMidnight.setSeconds(0);
			endDateMidnight.setMilliseconds(0);
			let isoDayEnd = endDateMidnight.toISOString(); // +18 hours because of 6h intervals

			// get rain amounts
			let rainJSON;
			try {
				const resp = await fetch(`https://climathon.iblsoft.com/data/gefs-0.25deg/edr/collections/single-level_2/position?coords=POINT(${lon} ${lat})&parameter-name=total-precipitation_gnd-surf_positively-perturbed_stat:acc/PT6H&datetime=${isoDayStart}/${isoDayEnd}&f=CoverageJSON`);
				rainJSON = await resp.json();
			} catch {
				console.log("Meteo request 2 failed");
				return res.sendStatus(500);
			}

			// calculate rain percentage from rain amounts
			const coverageCount = rainJSON.coverages.length;
			let rainPercent = 0;
			for (var j = 0; j < coverageCount; j++) {
				const nazov = "total-precipitation_gnd-surf_positively-perturbed_stat:acc/PT6H_mem-" + (Math.floor(j / (coverageCount / 30)) + 1);
				rainPercent += rainJSON.coverages[j].ranges[nazov].values[0] > 0.1;
			}
			rainPercent /= coverageCount;

			days[dayI].precipitation = Math.floor(rainPercent*100)

		} else {
			days[dayI].nightTemp = Math.floor(getEntry("temperature_gnd-surf").value-273.15)
		}

	}

	res.send({content:days});
})


app.get("/alerts", async (req, res) => {
	// get alerts from api
	const apiKey = process.env.WEATHERBIT_API_KEY;

	// get dates
	const NOW = new Date();
	NOW.setMinutes(NOW.getMinutes() - 1); // account for request delay

	const MAX_DATE = new Date();
	MAX_DATE.setHours(23);
	MAX_DATE.setMinutes(59);
	MAX_DATE.setSeconds(59);
	MAX_DATE.setMilliseconds(9999);

	// get and validate input values
	const lat = Number(req.query?.lat);
	if (isNaN(lat) || lat < -90 || lat > 90)
		return res.status(400).send("Invalid latitude");

	const lon = Number(req.query?.lon);
	if (isNaN(lon) || lon < -180 || lon > 180)
		return res.status(400).send("Invalid longitude");

	const endDate = Number(req.query.endDate);
	if (isNaN(endDate) || endDate < NOW.valueOf() || endDate > MAX_DATE.valueOf())
		return res.sendStatus(200);

	let alertJSON;
	try {
		const resp = await fetch(`https://api.weatherbit.io/v2.0/alerts?lat=${lat}&lon=${lon}&key=${apiKey}`);
		alertJSON = await resp.json();
	} catch {
		console.log("Alert request failed");
		return res.sendStatus(500);
	}

	let hainesJSON;
	try {
		const resp = await fetch(`https://climathon.iblsoft.com/data/gfs-0.5deg/edr/collections/single-layer/position?coords=POINT(${lon} ${lat})&parameter-name=haines-index_gnd-surf&datetime=${new Date().toISOString()}&f=CoverageJSON`);
		hainesJSON = await resp.json();
	} catch {
		console.log("haines index request failed");
		return res.sendStatus(500);
	}

	

	// store unique output alerts
	const alerts = [];

	if (hainesJSON.ranges["haines-index_gnd-surf"].values[0] > 5) {
		const gptResponse = await openai.chat.completions.create({
			messages: [
				{ role: 'system', content: SYS_MSG_ALERTS },
				{ role: 'user', content: `
					Haines Index is high, pay attention when setting fire as it can spread rapidly
				` }
			],
			model: 'gpt-3.5-turbo',
			temperature: 0,
		});
		alerts.push({
			"title": "High Haines Index",
			"description": gptResponse.choices[0].message.content,
			"severity": "advisory"
		});
	}

	// capture unique alerts
	var alertNames = new Set(alertJSON.alerts.map(obj => obj.title));
	for (const alertName of alertNames) {
		var alert = alertJSON.alerts.find(obj => obj.title == alertName);
		const gptResponse = await openai.chat.completions.create({
			messages: [
				{ role: 'system', content: SYS_MSG_ALERTS },
				{ role: 'user', content: alert.description }
			],
			model: 'gpt-3.5-turbo',
			temperature: 0,
		});
		alerts.push({
			"title": alert.title,
			"description": gptResponse.choices[0].message.content,
			"severity": alert.severity
		});
	};

	res.send({content:alerts});
});
	
app.get("/air", async (req, res) => {
	// get air info from api
	const apiKey = process.env.WEATHERBIT_API_KEY
	
	// get dates
	const NOW = new Date();
	NOW.setMinutes(NOW.getMinutes() - 1); // account for request delay

	const MAX_DATE = new Date();
	MAX_DATE.setHours(23);
	MAX_DATE.setMinutes(59);
	MAX_DATE.setSeconds(59);
	MAX_DATE.setMilliseconds(9999);

	// get and validate input params
	const lat = Number(req.query?.lat);
	if (isNaN(lat) || lat < -90 || lat > 90)
		return res.status(400).send("Invalid latitude");

	const lon = Number(req.query?.lon);
	if (isNaN(lon) || lon < -180 || lon > 180)
		return res.status(400).send("Invalid longitude");

	const endDate = Number(req.query.endDate);
	if (isNaN(endDate) || endDate < NOW.valueOf() || endDate > MAX_DATE.valueOf())
		return res.sendStatus(200);


	let airJSON;
	try {
		const resp = await fetch(`https://api.weatherbit.io/v2.0/current/airquality?lat=${lat}&lon=${lon}&key=${apiKey}`);
		airJSON = await resp.json();
	} catch {
		console.log("Air info request failed");
		return res.sendStatus(500);
	}

	// helper functions
	const clamp = (val, min = 0, max = 1) => Math.min(max, Math.max(min, val));
	const normalize = (val, max = 100) => clamp(val, 0, max) / max;
	const valsplit = (val, namesSplit, nameEmpty = undefined, treshold = 0.1) => val > treshold ? namesSplit[Math.floor(val / (1 / namesSplit.length + 0.01))] : (typeof nameEmpty == undefined ? nameEmpty : namesSplit[0]);

	// capture unique air info
	const jsonData = airJSON.data[0];
	const aqi = jsonData.aqi;
	const pollen = Math.max(jsonData.pollen_level_grass, jsonData.pollen_level_tree, jsonData.pollen_level_weed);
	const mold = jsonData.mold_level;

	// translate info into text
	const aqiText = valsplit(normalize(aqi, 300), [null, null, "Unhealthy", "Very Unhealthy", "Hazardous"]);
	const pollenText = valsplit(normalize(pollen, 4), [null, "Low", "Medium", "High"]);
	const moldText = valsplit(normalize(mold, 4), [null, "Low", "Medium", "High"]);

	// filter info by severity
	let data = {
		aqi: aqiText,
		pollen_level: pollenText,
		mold_level: moldText
	};
	data = Object.fromEntries(Object.entries(data).filter(e => e[1] !== null && e[1] !== undefined));

	res.send(data);
})


// should be at end of file
app.listen(port, () => {
	console.log(`Example app listening on port ${port}`);
})